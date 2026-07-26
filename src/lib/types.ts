/** Shapes returned by the API, as seen by the browser (dates are ISO strings). */

export type ApiEvent = {
  id: string;
  title: string;
  note: string | null;
  location: string | null;
  startsAt: string;
  endsAt: string | null;
  allDay: boolean;
  category: string;
  remindMinutes: number[];
  statement?: { id: string; paid: boolean; cardId: string } | null;
};

export type ApiTodo = {
  id: string;
  title: string;
  note: string | null;
  dueAt: string | null;
  priority: number;
  done: boolean;
  doneAt: string | null;
  createdAt: string;
};

export type ApiStatement = {
  id: string;
  cardId: string;
  period: string;
  amount: number | null;
  minimum: number | null;
  dueAt: string;
  paid: boolean;
  paidAt: string | null;
  paidAmount: number | null;
  /** Sum of this card's logged expenses within the statement's billing cycle. */
  trackedSpend: number;
};

export type ApiCard = {
  id: string;
  name: string;
  issuer: string | null;
  last4: string | null;
  statementDay: number;
  dueDay: number;
  dueNextMonth: boolean;
  autoPay: boolean;
  color: string;
  active: boolean;
  remindDaysBefore: number[];
  statements: ApiStatement[];
};

export type ApiBill = {
  id: string;
  cardId: string;
  card: string;
  color: string;
  autoPay: boolean;
  period: string;
  amount: number | null;
  dueAt: string;
  daysLeft: number;
  overdue: boolean;
  status: string;
};

export type ApiExpense = {
  id: string;
  amount: number;
  category: string;
  merchant: string | null;
  note: string | null;
  spentAt: string;
  cardId: string | null;
  source: string;
  card?: { id: string; name: string; color: string } | null;
};

export type ApiInsight = {
  summary: string;
  highlights: string[];
  tips: Array<{ title: string; detail: string; monthlySaving: number | null }>;
  warnings: string[];
  generatedAt: string;
  stats: {
    period: string;
    total: number;
    count: number;
    days: number;
    dailyAverage: number;
    projectedTotal: number;
    budget: number | null;
    prevPeriod: string;
    prevTotal: number;
    categories: Array<{
      key: string;
      label: string;
      total: number;
      count: number;
      share: number;
      prevTotal: number;
      delta: number;
    }>;
    topMerchants: Array<{ merchant: string; total: number; count: number }>;
    byCard: Array<{ card: string; total: number; count: number }>;
    recurring: Array<{ merchant: string; monthlyAverage: number; months: number }>;
    billTotal: number;
    unpaidBills: Array<{ card: string; period: string; amount: number | null; dueAt: string }>;
  };
};
