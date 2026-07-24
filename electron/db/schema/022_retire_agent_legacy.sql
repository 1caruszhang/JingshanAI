-- #81: Retire legacy agent runtime tables.
-- execution_ledger was written by the old toolGuard/executionLedger audit path.
-- agent_locks was an unimplemented stub for the old geoAgentRuntime.
-- Both are superseded by the CEO DeepAgent + LangGraph checkpoint path.
DROP TABLE IF EXISTS execution_ledger;
DROP TABLE IF EXISTS agent_locks;
