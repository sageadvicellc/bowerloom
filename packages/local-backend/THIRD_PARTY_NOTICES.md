# Third-party notices

The local profile adapts the reviewed Supabase proof in `experiments/alpha-backend`. That proof derives from Supabase `self-hosted/v0.8.2` under Apache 2.0.

The Apache 2.0 license is retained in `licenses/supabase-Apache-2.0.txt`. Each pinned container image retains its upstream license terms.

Bowerloom changes project ownership, approval planning, private paths, image downloads, ports, lifecycle operations, health observations, and failure records.

The PostgreSQL role statements preserve the earlier proof's role targets. This package generates password literals from random hexadecimal credentials instead of shell substitutions.

The profile does not bundle or start proprietary DBOS Conductor. The existing framework uses the MIT DBOS library separately.
