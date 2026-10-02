# Labs experiment to draft PR

Portable recipe validation, a scoped GitHub REST adapter, PostgreSQL approval/effect records, and a thin LangGraph graph with PostgreSQL checkpoints. Personal agents supply prose; this package calls no model.

See [the operator guide](../../docs/recipes/labs-to-blog.md), [skill](../../skills/recipes/labs-to-blog/SKILL.md), and [verification record](../../docs/recipes/implementation-evidence.md).

`RecipeService` shares setup, plan, review, approve, run, reconcile, cancel and status operations. The CLI/MCP startup controller in `apps/cli/src/recipe.ts` seals one installation. The recipe effect controller is the only GitHub mutation/reconciliation owner. LangGraph replay delegates to that controller and cannot bypass its durable claims.

No merge, publication, arbitrary shell, arbitrary host, paid API, new model route, DBOS replacement, or automatic approval is included. The existing craft-shop and DBOS paths are unchanged.

File effects require a complete single-path Git tree proof and a durable commit receipt before PR dispatch or recovery. Receipt-less v1 job records are refused. GitHub ref/PR operations still require the documented single-writer namespace; the adapter does not claim atomic compare-and-swap across remote reads and writes.
