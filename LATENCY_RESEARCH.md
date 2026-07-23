# Robinhood Buy Latency Research

Date: 2026-07-23

No transaction was submitted while gathering this evidence.

## Findings

Compared on-chain Trench and GMGN buy transactions did not support a router
migration: GMGN used a more expensive proxy route with a 1% native-input fee,
and its configured priority fee was not realized. Block data also has no click
or first-seen-mempool time, so it cannot prove client broadcast latency.

Read-only WETH-to-token discovery on the public Robinhood RPC measured about
460 ms warm. Individual V3, Doppler, and liquidity reads commonly measured
116-199 ms. The click-critical path also contains the live quote, mandatory
payable simulation, local signing, RPC transaction preparation, and accepted
raw-transaction broadcast.

## Changes

- Hovering a GMGN BUY begins read-only WETH-to-token route discovery.
- Successful routes are cached only in service-worker memory for 10 seconds.
- Native ETH balance validation starts beside route discovery rather than before
  it; final payable simulation still validates the selected route.
- After accepted broadcast and journal write, the trade returns `pending` and a
  background monitor updates receipt status without retransmitting.

## Preserved Invariants

- Native ETH buys, supported V3/Doppler/Virtuals routes, slippage calculation,
  exact sell approval, and mandatory final `simulateContract` are unchanged.
- Prewarming does not sign or send a transaction.
- No transaction submission is retried.
- The private key remains scoped to an individual trade; no signer client is
  retained in service-worker memory.

## Expected Effect

A hovered GMGN card removes route discovery from the click path. A cold click
overlaps its native-balance read with discovery. Batch accounts can begin the
next broadcast after the previous accepted broadcast, rather than after block
receipt. Network quote, simulation, signing, preparation, and broadcast
acknowledgement remain mandatory critical-path work.
