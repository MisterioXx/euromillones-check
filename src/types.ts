export type Participant = {
  id: string;
  name: string;
  annualContribution: number;
  extraContribution: number;
};

export type DrawStatus = "pending" | "checked" | "manual";

export type DrawEntry = {
  id: string;
  date: string;
  played: boolean;
  lines: number;
  costPerLine: number;
  grossPrize: number;
  expenses: number;
  notes: string;
  status: DrawStatus;
  checkedAt?: string;
  winningNumbers?: number[];
  winningStars?: number[];
};

export type CashMovement = {
  id: string;
  date: string;
  amount: number;
  description: string;
  kind: "adjustment" | "external-ticket" | "other";
};

export type LogEntry = {
  id: string;
  at: string;
  level: "info" | "warning" | "error";
  message: string;
  details?: string;
};

export type AppConfig = {
  startDate: string;
  endDate: string;
  numbers: number[];
  stars: number[];
  defaultCostPerLine: number;
  defaultLines: number;
  autoCheckOnOpen: boolean;
};

export type AppState = {
  version: 1;
  config: AppConfig;
  participants: Participant[];
  draws: DrawEntry[];
  movements: CashMovement[];
  logs: LogEntry[];
};

export type OfficialCheckResponse = {
  ok: boolean;
  source: string;
  fetchedAt: string;
  requestedDate?: string;
  date?: string;
  numbers?: number[];
  stars?: number[];
  prizeAmount?: number;
  category?: string;
  prizes?: Array<{
    category: string;
    amount: number;
    formattedAmount: string;
  }>;
  message?: string;
  rawSnippet?: string;
};
