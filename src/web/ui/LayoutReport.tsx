import { reportLine, reportWarnings, type LayoutReport } from "../../core/report";

/** The layout report in one line, with its unrounded numbers as attributes (ui contract, Layout report). */
export function LayoutReportLine({ report, nameOf }: { report: LayoutReport; nameOf?: (id: string) => string }) {
  const warnings = reportWarnings(report, nameOf);
  return (
    <div className="layout-report" data-testid="layout-report"
      data-crossings={report.crossings} data-over-parts={report.edgesOverParts.length} data-cut={report.cutText.length}
      data-over-limit={report.overLimitText.length} data-in-place={report.smallestText.inPlace} data-opened={report.smallestText.opened}
      data-level={report.smallestText.level} data-parts={report.counts.parts} data-zones={report.counts.zones}
      data-connections={report.counts.connections} data-longest={report.longestConnection} data-view={report.view} data-format={report.format}>
      <span>{reportLine(report)}</span>
      {warnings.length > 0 && (
        <ul data-testid="layout-report-warning">{warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
      )}
    </div>
  );
}
