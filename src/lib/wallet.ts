// Client-side wallet store backed by localStorage.
// All data is local to the browser; this is a demo, not real money.

export type TxnType = 'send' | 'request' | 'topup';

export interface User {
  id: string;
  email: string;
  name: string;
  password: string; // demo only — stored in plaintext locally
  balance: number;
  createdAt: number;
}

export interface Txn {
  id: string;
  type: TxnType;
  fromId: string;
  toId: string;
  amount: number;
  note: string;
  status: 'completed' | 'pending' | 'declined';
  createdAt: number;
}

const USERS_KEY = 'pp.users';
const TXNS_KEY = 'pp.txns';
const SESSION_KEY = 'pp.session';

function read<T>(key: string, fallback: T): T {
  if (typeof localStorage === 'undefined') return fallback;
  const raw = localStorage.getItem(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function getUsers(): User[] {
  return read<User[]>(USERS_KEY, []);
}

export function saveUsers(users: User[]): void {
  write(USERS_KEY, users);
}

export function getTxns(): Txn[] {
  return read<Txn[]>(TXNS_KEY, []);
}

export function saveTxns(txns: Txn[]): void {
  write(TXNS_KEY, txns);
}

export function getUser(id: string): User | undefined {
  return getUsers().find((u) => u.id === id);
}

export function findUserByEmail(email: string): User | undefined {
  const e = email.trim().toLowerCase();
  return getUsers().find((u) => u.email.toLowerCase() === e);
}

// --- session ---

export function getSession(): string | null {
  return read<string | null>(SESSION_KEY, null);
}

export function setSession(userId: string | null): void {
  if (userId === null) {
    localStorage.removeItem(SESSION_KEY);
  } else {
    write(SESSION_KEY, userId);
  }
}

export function getCurrentUser(): User | undefined {
  const id = getSession();
  return id ? getUser(id) : undefined;
}

// --- auth ---

export function signup(name: string, email: string, password: string): User {
  if (findUserByEmail(email)) {
    throw new Error('An account with that email already exists.');
  }
  const user: User = {
    id: uid(),
    email: email.trim(),
    name: name.trim(),
    password,
    balance: 0,
    createdAt: Date.now(),
  };
  const users = getUsers();
  users.push(user);
  saveUsers(users);
  setSession(user.id);
  return user;
}

export function login(email: string, password: string): User {
  const user = findUserByEmail(email);
  if (!user || user.password !== password) {
    throw new Error('Invalid email or password.');
  }
  setSession(user.id);
  return user;
}

export function logout(): void {
  setSession(null);
}

export function topUp(amount: number): User {
  const user = requireCurrent();
  if (amount <= 0) throw new Error('Amount must be positive.');
  user.balance += amount;
  persistUser(user);
  recordTxn({ type: 'topup', fromId: user.id, toId: user.id, amount, status: 'completed' });
  return user;
}

export function sendMoney(toEmail: string, amount: number, note: string): Txn {
  const sender = requireCurrent();
  const recipient = findUserByEmail(toEmail);
  if (!recipient) throw new Error('Recipient not found.');
  if (recipient.id === sender.id) throw new Error("You can't send to yourself.");
  if (amount <= 0) throw new Error('Amount must be positive.');
  if (sender.balance < amount) throw new Error('Insufficient balance.');

  sender.balance -= amount;
  recipient.balance += amount;
  persistUser(sender);
  persistUser(recipient);
  return recordTxn({
    type: 'send',
    fromId: sender.id,
    toId: recipient.id,
    amount,
    note,
    status: 'completed',
  });
}

export function requestMoney(fromEmail: string, amount: number, note: string): Txn {
  const requester = requireCurrent();
  const from = findUserByEmail(fromEmail);
  if (!from) throw new Error('That user was not found.');
  if (from.id === requester.id) throw new Error("You can't request from yourself.");
  if (amount <= 0) throw new Error('Amount must be positive.');
  return recordTxn({
    type: 'request',
    fromId: requester.id,
    toId: from.id,
    amount,
    note,
    status: 'pending',
  });
}

export function fulfillRequest(txnId: string): void {
  const txns = getTxns();
  const txn = txns.find((t) => t.id === txnId);
  if (!txn || txn.type !== 'request' || txn.status !== 'pending') {
    throw new Error('Request not found.');
  }
  const me = requireCurrent();
  if (me.id !== txn.toId) throw new Error('Not your request to fulfill.');
  if (me.balance < txn.amount) throw new Error('Insufficient balance.');

  const requester = getUser(txn.fromId);
  if (!requester) throw new Error('Requester no longer exists.');

  me.balance -= txn.amount;
  requester.balance += txn.amount;
  persistUser(me);
  persistUser(requester);

  txn.status = 'completed';
  saveTxns(txns);
}

export function declineRequest(txnId: string): void {
  const txns = getTxns();
  const txn = txns.find((t) => t.id === txnId);
  if (!txn) throw new Error('Request not found.');
  const me = requireCurrent();
  if (me.id !== txn.toId) throw new Error('Not your request to decline.');
  txn.status = 'declined';
  saveTxns(txns);
}

export function myTxns(): Txn[] {
  const me = requireCurrent();
  return getTxns()
    .filter((t) => t.fromId === me.id || t.toId === me.id)
    .sort((a, b) => b.createdAt - a.createdAt);
}

function recordTxn(partial: Omit<Txn, 'id' | 'createdAt'>): Txn {
  const txns = getTxns();
  const txn: Txn = { ...partial, id: uid(), createdAt: Date.now() };
  txns.push(txn);
  saveTxns(txns);
  return txn;
}

function persistUser(user: User): void {
  const users = getUsers();
  const i = users.findIndex((u) => u.id === user.id);
  if (i >= 0) {
    users[i] = user;
    saveUsers(users);
  }
}

function requireCurrent(): User {
  const u = getCurrentUser();
  if (!u) throw new Error('Not logged in.');
  return u;
}

export function seedDemo(): void {
  if (getUsers().length > 0) return;
  const alice: User = {
    id: uid(),
    email: 'alice@demo.io',
    name: 'Alice Demo',
    password: 'password',
    balance: 0,
    createdAt: Date.now(),
  };
  const bob: User = {
    id: uid(),
    email: 'bob@demo.io',
    name: 'Bob Demo',
    password: 'password',
    balance: 0,
    createdAt: Date.now(),
  };
  saveUsers([alice, bob]);

  // Seed a realistic history of transactions across several days.
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.now();
  const t = (offsetDays: number, hour = 10): number =>
    now - offsetDays * DAY + (hour - new Date(now).getHours()) * 60 * 60 * 1000;

  const txns: Txn[] = [
    // Top-ups
    { id: uid(), type: 'topup', fromId: alice.id, toId: alice.id, amount: 500, note: 'Bank transfer', status: 'completed', createdAt: t(6, 9) },
    { id: uid(), type: 'topup', fromId: bob.id, toId: bob.id, amount: 200, note: 'Debit card', status: 'completed', createdAt: t(5, 14) },
    // Alice sends to Bob (coffee, rent share)
    { id: uid(), type: 'send', fromId: alice.id, toId: bob.id, amount: 12.5, note: 'Coffee at Blue Bottle', status: 'completed', createdAt: t(4, 8) },
    { id: uid(), type: 'send', fromId: alice.id, toId: bob.id, amount: 45, note: 'Dinner split', status: 'completed', createdAt: t(3, 19) },
    // Bob sends to Alice (birthday)
    { id: uid(), type: 'send', fromId: bob.id, toId: alice.id, amount: 25, note: 'Happy birthday!', status: 'completed', createdAt: t(2, 11) },
    // Alice top-up again
    { id: uid(), type: 'topup', fromId: alice.id, toId: alice.id, amount: 100, note: 'Bank transfer', status: 'completed', createdAt: t(2, 9) },
    // Bob requests from Alice
    { id: uid(), type: 'request', fromId: bob.id, toId: alice.id, amount: 30, note: 'Concert tickets', status: 'pending', createdAt: t(1, 16) },
    // Alice sends to Bob today
    { id: uid(), type: 'send', fromId: alice.id, toId: bob.id, amount: 18.75, note: 'Lunch', status: 'completed', createdAt: t(0, 12) },
    // Bob top-up today
    { id: uid(), type: 'topup', fromId: bob.id, toId: bob.id, amount: 50, note: 'Bank transfer', status: 'completed', createdAt: t(0, 8) },
    // Alice requests from Bob (declined earlier example)
    { id: uid(), type: 'request', fromId: alice.id, toId: bob.id, amount: 60, note: 'Gift', status: 'declined', createdAt: t(5, 10) },
  ];

  // Reconcile balances from completed transactions.
  for (const txn of txns) {
    if (txn.status !== 'completed') continue;
    if (txn.type === 'topup') {
      const u = txn.fromId === alice.id ? alice : bob;
      u.balance += txn.amount;
    } else if (txn.type === 'send') {
      const from = txn.fromId === alice.id ? alice : bob;
      const to = txn.toId === alice.id ? alice : bob;
      from.balance -= txn.amount;
      to.balance += txn.amount;
    }
  }

  saveUsers([alice, bob]);
  saveTxns(txns);
}
