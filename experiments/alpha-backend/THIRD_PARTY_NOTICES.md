# Third-party notices

The files `infra/roles.sql` and `infra/jwt.sql` are unchanged Supabase source files. They come from the `self-hosted/v0.8.2` tag. Supabase licenses these files under Apache 2.0. The original license is in `licenses/supabase-Apache-2.0.txt`.

The generated Compose configuration adapts the Supabase Docker reference from that tag. Trellis changes component selection, image pins, network configuration, credentials, resource limits, and lifecycle commands.

The DBOS SDK dependency uses MIT. Its license is in `licenses/dbos-MIT.txt`. The dependency lock identifies the exact SDK package and its integrity value. Each container image retains its own upstream license terms.
