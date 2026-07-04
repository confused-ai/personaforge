/**
 * @confused-ai/simulation — a wind tunnel for agents.
 *
 * Run an agent against many scenarios, record every run into the durable log,
 * and get aggregate pass/fail statistics. Failing scenarios stay replayable.
 */

export { simulate } from './simulate.js';
export type {
  SimAgentConfig,
  Scenario,
  ScenarioOutcome,
  SimReport,
  SimulateOptions,
} from './simulate.js';
