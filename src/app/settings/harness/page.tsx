import { Suspense } from "react";
import HarnessConsolePage from "./harness-console-page";

export default function HarnessSettingsPage() {
  return (
    <Suspense fallback={null}>
      <HarnessConsolePage />
    </Suspense>
  );
}
