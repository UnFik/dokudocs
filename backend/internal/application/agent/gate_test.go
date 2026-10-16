package agent

import (
	"context"
	"errors"
	"strings"
	"testing"
)

type fakeClassifier struct {
	result ClassifierResult
	err    error
	calls  int
}

func (f *fakeClassifier) Classify(context.Context, string) (ClassifierResult, error) {
	f.calls++
	return f.result, f.err
}

func decide(t *testing.T, g *Gate, in GateInput) GateDecision {
	t.Helper()
	return g.Decide(context.Background(), in)
}

func TestARequestToChangeSomethingIsAnEditWithoutAskingAModel(t *testing.T) {
	c := &fakeClassifier{}
	g := NewGate(c)
	for _, q := range []string{"Ubah judul dokumen menjadi Rencana Q4", "please add a section about rollback", "hapus bagian deploy", "Tulis ringkasan di akhir dokumen"} {
		d := decide(t, g, GateInput{Question: q})
		if d.Label != LabelEdit || d.Source != SourceRule || d.Reason != "edit_verb" {
			t.Fatalf("%q -> %+v", q, d)
		}
	}
	if c.calls != 0 {
		t.Fatalf("the classifier was asked %d times for clear requests", c.calls)
	}
}

func TestAShortQuestionThatOnlyReadsIsSimple(t *testing.T) {
	g := NewGate(&fakeClassifier{})
	for _, q := range []string{"Apa isi dokumen deployment?", "who wrote the release notes?", "Berapa dokumen di project Alpha?"} {
		if d := decide(t, g, GateInput{Question: q}); d.Label != LabelSimple || d.Reason != "read_question" {
			t.Fatalf("%q -> %+v", q, d)
		}
	}
	long := "Apa " + strings.Repeat("kata ", 80) + "?"
	if d := decide(t, NewGate(nil), GateInput{Question: long}); d.Label == LabelSimple {
		t.Fatalf("a long question was called simple: %+v", d)
	}
}

func TestASkillCallIsTreatedAsAnEditBecauseASkillMayChangeThings(t *testing.T) {
	d := decide(t, NewGate(nil), GateInput{Question: "the release notes", Skill: "summary"})
	if d.Label != LabelEdit || d.Reason != "skill" {
		t.Fatalf("decision = %+v", d)
	}
}

func TestThisDocumentInAWorkspaceChatWithoutAMentionNeedsAClarification(t *testing.T) {
	g := NewGate(nil)
	d := decide(t, g, GateInput{Question: "Ringkas dokumen ini"})
	if d.Label != LabelClarify || d.Reason != "unnamed_document" || d.Question == "" {
		t.Fatalf("decision = %+v", d)
	}
	for _, in := range []GateInput{
		{Question: "Ringkas dokumen ini", DocumentScoped: true},
		{Question: "Ringkas dokumen ini @[Deploy](doc:11111111-1111-1111-1111-111111111111)", HasMentions: true},
	} {
		if d := decide(t, g, in); d.Label == LabelClarify {
			t.Fatalf("%+v asked for a clarification it did not need: %+v", in, d)
		}
	}
}

func TestAnUnclearRequestGoesToTheClassifierAndItsAnswerIsUsed(t *testing.T) {
	c := &fakeClassifier{result: ClassifierResult{Label: LabelClarify, Confidence: 0.9, Question: "Bagian mana yang Anda maksud?"}}
	d := decide(t, NewGate(c), GateInput{Question: "yang tadi itu gimana ya"})
	if d.Label != LabelClarify || d.Source != SourceModel || d.Question != "Bagian mana yang Anda maksud?" || c.calls != 1 {
		t.Fatalf("decision = %+v after %d calls", d, c.calls)
	}
}

func TestOnlyAConfidentClassifierMayTurnARequestAwayAsOutOfDomain(t *testing.T) {
	sure := NewGate(&fakeClassifier{result: ClassifierResult{Label: LabelOutOfDomain, Confidence: 0.95}})
	if d := decide(t, sure, GateInput{Question: "cuaca besok di Jakarta panas banget"}); d.Label != LabelOutOfDomain {
		t.Fatalf("decision = %+v", d)
	}
	unsure := NewGate(&fakeClassifier{result: ClassifierResult{Label: LabelOutOfDomain, Confidence: 0.6}})
	if d := decide(t, unsure, GateInput{Question: "cuaca besok di Jakarta panas banget"}); d.Label != LabelGeneral || d.Reason != "low_confidence" {
		t.Fatalf("an unsure classifier turned the request away: %+v", d)
	}
}

func TestAFailingClassifierNeverBlocksTheRequest(t *testing.T) {
	g := NewGate(&fakeClassifier{err: errors.New("provider down")})
	d := decide(t, g, GateInput{Question: "yang tadi itu gimana ya"})
	if d.Label != LabelGeneral || d.Reason != "classifier_failed" {
		t.Fatalf("decision = %+v", d)
	}
	if d := decide(t, NewGate(nil), GateInput{Question: "yang tadi itu gimana ya"}); d.Label != LabelGeneral || d.Reason != "no_classifier" {
		t.Fatalf("without a classifier: %+v", d)
	}
}

func TestTheSmallModelClassifierReadsItsJSONAnswerAndSendsOnlyTheQuestion(t *testing.T) {
	m := &scriptedModel{replies: []Message{{Role: "assistant", Content: "```json\n{\"label\":\"out_of_domain\",\"confidence\":0.93}\n```"}}}
	result, err := NewModelClassifier(m).Classify(context.Background(), "cuaca besok di Jakarta panas banget")
	if err != nil || result.Label != LabelOutOfDomain || result.Confidence != 0.93 {
		t.Fatalf("Classify() = %+v, %v", result, err)
	}
	sent := m.seen[0]
	if len(m.tools[0]) != 0 || sent[len(sent)-1].Content != "cuaca besok di Jakarta panas banget" {
		t.Fatalf("the classifier was sent tools %v or more than the question: %+v", m.tools[0], sent)
	}
}

func TestAClassifierAnswerThatIsNotAKnownLabelIsAnError(t *testing.T) {
	for _, reply := range []string{"I think it is fine", `{"label":"delete_everything","confidence":1}`, `{"label":"clarify","confidence":7}`} {
		m := &scriptedModel{replies: []Message{{Role: "assistant", Content: reply}}}
		if _, err := NewModelClassifier(m).Classify(context.Background(), "x y z"); err == nil {
			t.Fatalf("%q was accepted", reply)
		}
	}
}
