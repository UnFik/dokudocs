package websocket

import (
	"testing"

	"backend/internal/application/collaboration"
)

// What a peer may write is edit, suggest, or nothing. A change between any two of
// these, with no change to the body, must resync the peer so its client learns of
// it, and the ready frame must say which it has.

func TestWriteLevelFollowsEditThenSuggestAccess(t *testing.T) {
	for _, tc := range []struct {
		canEdit, canSuggest bool
		want                writeLevel
	}{
		{true, true, fullEdit},
		{true, false, fullEdit},
		{false, true, suggestOnly},
		{false, false, readOnly},
	} {
		if got := levelOf(tc.canEdit, tc.canSuggest); got != tc.want {
			t.Errorf("levelOf(%v, %v) = %v, want %v", tc.canEdit, tc.canSuggest, got, tc.want)
		}
	}
}

func TestSnapshotMessageTellsTheClientWhetherItMaySuggest(t *testing.T) {
	for _, tc := range []struct {
		canEdit, canSuggest bool
	}{{true, true}, {false, true}, {false, false}} {
		message := snapshotMessage("ready", collaboration.BodySnapshot{CanEdit: tc.canEdit, CanSuggest: tc.canSuggest})
		if message.CanEdit == nil || *message.CanEdit != tc.canEdit || message.CanSuggest == nil || *message.CanSuggest != tc.canSuggest {
			t.Errorf("ready for canEdit %v canSuggest %v = %+v", tc.canEdit, tc.canSuggest, message)
		}
	}
}

func TestEnqueueResyncsWhenAPeerMovesBetweenCommentAndViewAccess(t *testing.T) {
	for name, tc := range map[string]struct {
		from  writeLevel
		to    collaboration.BodySnapshot
		level writeLevel
	}{
		"comment access revoked to view": {suggestOnly, collaboration.BodySnapshot{CanSuggest: false}, readOnly},
		"view access raised to comment":  {readOnly, collaboration.BodySnapshot{CanSuggest: true}, suggestOnly},
		"comment access raised to edit":  {suggestOnly, collaboration.BodySnapshot{CanEdit: true, CanSuggest: true}, fullEdit},
		"edit access lowered to comment": {fullEdit, collaboration.BodySnapshot{CanSuggest: true}, suggestOnly},
	} {
		t.Run(name, func(t *testing.T) {
			peer := &peer{out: make(chan outbound, 1), done: make(chan struct{}), bodyVersion: 4, bodyEpoch: 2, level: tc.from}
			snapshot := tc.to
			snapshot.BodyVersion, snapshot.BodyEpoch, snapshot.BodySchemaVersion, snapshot.EncodedState = 4, 2, 1, []byte("state")

			peer.enqueueResyncIfAhead(snapshot)

			message := <-peer.out
			if message.message.Type != "resync" || message.message.CanSuggest == nil || *message.message.CanSuggest != snapshot.CanSuggest {
				t.Fatalf("resync = %+v, want one carrying canSuggest %v", message.message, snapshot.CanSuggest)
			}
			if peer.level != tc.level {
				t.Fatalf("peer level = %v, want %v", peer.level, tc.level)
			}
		})
	}
}

func TestNoResyncWhenAccessIsTheSame(t *testing.T) {
	peer := &peer{out: make(chan outbound, 1), done: make(chan struct{}), bodyVersion: 4, bodyEpoch: 2, level: suggestOnly}
	peer.enqueueResyncIfAhead(collaboration.BodySnapshot{BodyVersion: 4, BodyEpoch: 2, BodySchemaVersion: 1, CanSuggest: true})
	select {
	case message := <-peer.out:
		t.Fatalf("resynced a peer whose access did not change: %+v", message.message)
	default:
	}
}
