# Market Cycle Snapshot

This directory is a lightweight, git-tracked snapshot for the cloud trading-system app.

It is used when the Tencent Cloud deployment only clones the `licai` repository and
does not have the full Shouzhuo research workspace next to it.

Contents:

- `quant/signals/*-market-cycle-position.json`: latest market-cycle position snapshot for the position gate.
- `quant/signals/market-cycle-position-history.csv`: compact cycle decision history.
- `quant/signals/market-cycle-position-history-2y.csv`: two-year review history used for longer-cycle audit.
- `quant/signals/market-breadth-history.csv`: merged verified/proxy breadth history.

This is not the full raw-data workspace. Full refresh still requires a research
workspace containing `scripts/market_cycle_position.py` and the upstream data files.
Set `SHOUZHUO_MARKET_ROOT` on the server when that workspace is available.
