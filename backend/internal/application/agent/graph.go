package agent

// The decision graph: the places a request can pass through, and the ways from one to
// the next. It is data, so the page that shows a run draws the same graph the Agent
// follows, and a step on a place that is not here cannot be recorded.
const (
	NodeInput      = "input"
	NodeContext    = "context"
	NodeGate       = "gate"
	NodeReject     = "reject"
	NodeClarify    = "clarify"
	NodeRoute      = "route"
	NodeModelSmall = "model_small"
	NodeModelLarge = "model_large"
	NodeTools      = "tools"
	NodeApproval   = "approval"
	NodeRespond    = "respond"
)

// Edge names, the way a step left the node before it.
const (
	EdgeDefault     = ""
	EdgeOutOfDomain = "out_of_domain"
	EdgeClarify     = "clarify"
	EdgeProceed     = "proceed"
	EdgeSimple      = "simple"
	EdgeFull        = "full"
	EdgeToolCall    = "tool_call"
	EdgeToolResult  = "tool_result"
	EdgeNeedsOK     = "needs_approval"
	EdgeAnswer      = "answer"
	EdgeStopped     = "stopped"
)

type GraphNode struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	// Kind is how the page draws it: step, decision, model, tool or end.
	Kind string `json:"kind"`
	X    int    `json:"x"`
	Y    int    `json:"y"`
}

type GraphEdge struct {
	From  string `json:"from"`
	To    string `json:"to"`
	Label string `json:"label"`
}

type Graph struct {
	Nodes []GraphNode `json:"nodes"`
	Edges []GraphEdge `json:"edges"`
}

// DecisionGraph is the graph a request follows.
func DecisionGraph() Graph {
	return Graph{
		Nodes: []GraphNode{
			{NodeInput, "Input teks", "step", 0, 0},
			{NodeContext, "Ekstraksi + konteks", "step", 1, 0},
			{NodeGate, "Guardrails", "decision", 2, 0},
			{NodeReject, "Tolak", "end", 3, 0},
			{NodeClarify, "Minta klarifikasi", "end", 2, 1},
			{NodeRoute, "Router model", "decision", 1, 1},
			{NodeModelSmall, "Model kecil", "model", 0, 2},
			{NodeModelLarge, "Model utama", "model", 1, 2},
			{NodeTools, "Tool", "tool", 0, 3},
			{NodeApproval, "Menunggu persetujuan", "end", 1, 3},
			{NodeRespond, "Respons", "end", 2, 3},
		},
		Edges: []GraphEdge{
			{NodeInput, NodeContext, ""},
			{NodeContext, NodeGate, ""},
			{NodeGate, NodeReject, "Di luar domain"},
			{NodeGate, NodeClarify, "Belum pasti"},
			{NodeGate, NodeRoute, "Aman"},
			{NodeRoute, NodeModelSmall, "Sederhana"},
			{NodeRoute, NodeModelLarge, "Edit / umum"},
			{NodeModelSmall, NodeTools, "Query atau aksi"},
			{NodeModelLarge, NodeTools, "Query atau aksi"},
			{NodeTools, NodeModelSmall, "Hasil tool"},
			{NodeTools, NodeModelLarge, "Hasil tool"},
			{NodeTools, NodeApproval, "Perlu persetujuan"},
			{NodeModelSmall, NodeRespond, "Jawaban"},
			{NodeModelLarge, NodeRespond, "Jawaban"},
		},
	}
}

func knownNode(id string) bool {
	for _, n := range DecisionGraph().Nodes {
		if n.ID == id {
			return true
		}
	}
	return false
}
