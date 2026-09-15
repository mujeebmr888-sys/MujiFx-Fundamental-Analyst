/**
 * BLS CPI SNAPSHOT PARSER
 *
 * Backward-compatible CPI-specific entry point over the shared BLS monthly
 * snapshot parser. The parser validates rows but does not download files or
 * create vintage dates.
 */

import {
  parseBlsMonthlySnapshotRows,
  type BlsMonthlySnapshotCell,
} from "@/layers/data-acquisition/sources/bls-monthly-snapshot-parser";
import type { BlsCpiSnapshotRow } from "@/layers/data-acquisition/sources/bls-cpi-vintage";

export type BlsCpiSnapshotCell = BlsMonthlySnapshotCell;

export function parseBlsCpiSnapshotRows(
  cells: BlsCpiSnapshotCell[]
): BlsCpiSnapshotRow[] {
  return parseBlsMonthlySnapshotRows(cells);
}
