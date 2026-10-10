import { Simulator } from "@/components/Simulator";
import { SCENARIOS } from "@/lib/conversation/scenarios";

export default function SimulatorPage() {
  return (
    <>
      <div className="page-head">
        <div>
          <h1>Call simulator</h1>
          <p>
            Try the assistant without a phone line. Simulated calls go through the same rules, database, handoff and cost steps as real calls, are marked as demo, and are left out of the metrics unless you include them.
          </p>
        </div>
      </div>
      <Simulator scenarios={SCENARIOS} />
    </>
  );
}
