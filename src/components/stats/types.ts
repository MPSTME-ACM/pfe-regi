/** The shape `GET /api/stats` returns. Kept beside the panels that read it. */
export interface StatsResponse {
  success: boolean;
  /** Occupying registrations: success + comped. */
  total: number;
  /** Every row, whatever its status. */
  totalAll: number;
  /**
   * The four real buckets.
   *
   * Counted, never derived by subtraction. The old page computed
   * `pending = totalAll - successful`, which reported failed payments as
   * pending — 20 "pending" when 13 were mid-checkout and 7 had failed.
   */
  statuses: { success: number; comped: number; pending: number; failure: number };
  revenuePaise: number;
  /** Seats per track. A bundle occupies three, so these sum past `total`. */
  domains: Record<string, number>;
  skus: { capstone: number; single: number; bundle: number };
  combos: {
    beginner: string | null;
    advanced: string | null;
    capstone: boolean;
    count: number;
  }[];
  /** Known colleges only; 'Other' is pulled out into `fromOther`. */
  colleges: Record<string, number>;
  fromOther: number;
  /** Named other colleges. May total less than `fromOther` — rows created
   *  before the college name was collected have nothing to report. */
  otherColleges: Record<string, number>;
  departments: Record<string, number>;
  years: Record<string, number>;
  daily: Record<string, { success: number; pending: number; failure: number }>;
  referrers: {
    typed: { label: string; count: number; variants: number }[];
    attributed: { code: string; name: string; count: number }[];
  };
}
