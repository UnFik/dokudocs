//go:build integration

package document

import (
	"context"
	"testing"
	"time"

	"github.com/reearth/ygo/crdt"
)

type autoRevision struct {
	count       int
	bodyVersion int64
	xmin        string
}

func latestAutoRevision(t *testing.T, f *nodeDiffFixture) autoRevision {
	t.Helper()
	var revision autoRevision
	if err := f.db.QueryRowContext(context.Background(), `
		SELECT (SELECT COUNT(*) FROM document_revisions WHERE document_id = $1),
		       body_version, xmin::text
		FROM document_revisions WHERE document_id = $1
		ORDER BY version_number DESC LIMIT 1
	`, f.documentID).Scan(&revision.count, &revision.bodyVersion, &revision.xmin); err != nil {
		t.Fatalf("read latest revision: %v", err)
	}
	return revision
}

func TestAutoRevisionSnapshotIsWrittenAtMostOncePerDebounceInterval(t *testing.T) {
	f := newNodeDiffFixture(t, 3)
	paragraph := f.root().Children()[0].(*crdt.YXmlElement)
	text := paragraph.Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
	edit := func() {
		f.commit(t, func(tx *crdt.Transaction) { text.Insert(tx, text.Len(), "x", nil) })
	}

	f.writer.revisionDebounce = time.Hour
	edit()
	first := latestAutoRevision(t, f)
	if first.bodyVersion != 2 {
		t.Fatalf("first commit revision body_version = %d, want 2", first.bodyVersion)
	}
	edit()
	edit()
	if got := latestAutoRevision(t, f); got != first {
		t.Fatalf("revision after commits inside the interval = %+v, want it untouched %+v", got, first)
	}

	f.writer.revisionDebounce = 0
	edit()
	got := latestAutoRevision(t, f)
	if got.count != first.count || got.bodyVersion != 5 {
		t.Fatalf("revision once the interval passed = %+v, want the same row brought up to body_version 5", got)
	}
}

func TestFlushAutoRevisionBringsTheRollingRevisionUpToTheLatestBody(t *testing.T) {
	f := newNodeDiffFixture(t, 3)
	paragraph := f.root().Children()[0].(*crdt.YXmlElement)
	text := paragraph.Children()[0].(*crdt.YXmlElement).Children()[0].(*crdt.YXmlText)
	edit := func() {
		f.commit(t, func(tx *crdt.Transaction) { text.Insert(tx, text.Len(), "x", nil) })
	}

	f.writer.revisionDebounce = time.Hour
	edit()
	edit()
	edit()
	stale := latestAutoRevision(t, f)
	if stale.bodyVersion != 2 {
		t.Fatalf("setup: revision body_version = %d, want it trailing at 2 while the body is at 4", stale.bodyVersion)
	}

	if err := f.writer.FlushAutoRevision(context.Background(), f.documentID); err != nil {
		t.Fatalf("FlushAutoRevision(): %v", err)
	}
	got := latestAutoRevision(t, f)
	if got.count != stale.count || got.bodyVersion != 4 {
		t.Fatalf("revision after flush = %+v, want the same row at body_version 4", got)
	}

	if err := f.writer.FlushAutoRevision(context.Background(), f.documentID); err != nil {
		t.Fatalf("second FlushAutoRevision(): %v", err)
	}
	if again := latestAutoRevision(t, f); again != got {
		t.Fatalf("flush of an up-to-date revision rewrote it: %+v, want %+v", again, got)
	}
}
