import axe, { type ElementContext, type RunOptions } from "axe-core";
import { expect } from "vitest";

export async function expectNoA11yViolations(
  context: ElementContext = document,
  options?: RunOptions
) {
  const results = await axe.run(context, {
    ...options,
    rules: {
      ...options?.rules,
      // jsdom has no layout/canvas implementation, so contrast needs browser QA.
      "color-contrast": { enabled: false },
    },
  });
  const details = results.violations
    .map(
      (violation) =>
        `${violation.id}: ${violation.help}\n${violation.nodes
          .map((node) => `  ${node.target.join(" ")}: ${node.failureSummary}`)
          .join("\n")}`
    )
    .join("\n\n");

  expect(results.violations, details || "No accessibility violations").toEqual(
    []
  );
}
