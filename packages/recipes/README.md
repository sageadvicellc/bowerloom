# Labs experiment to draft PR

Portable recipe validation, a scoped GitHub REST adapter, PostgreSQL approval/effect records, and a thin LangGraph graph with PostgreSQL checkpoints. Personal agents supply prose; this package calls no model.

See [the operator guide](../../docs/recipes/labs-to-blog.md), [skill](../../skills/recipes/labs-to-blog/SKILL.md), and [verification record](../../docs/recipes/implementation-evidence.md).

`RecipeService` shares setup, plan, review, approve, run, reconcile, cancel and status operations. The CLI/MCP startup controller in `apps/cli/src/recipe.ts` seals one installation. The recipe effect controller is the only GitHub mutation/reconciliation owner. LangGraph replay delegates to that controller and cannot bypass its durable claims.

No merge, publication, arbitrary shell, arbitrary host, paid API, new model route, DBOS replacement, or automatic approval is included. The existing craft-shop and DBOS paths are unchanged.
