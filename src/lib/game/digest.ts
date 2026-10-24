/**
 * v1.9: arrival messages of one day fold into one line ("Днес: 5 курса
 * пристигнаха · нетно +2 340 лв."); everything else stays on its own.
 */
export interface DigestItem<T> {
  kind: 'one' | 'group';
  items: T[];
  day: string;
  count: number;
  netLv: number;
}

const sofiaDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Sofia' }).format(d);
const isArrival = (title: string) => title.startsWith('Доставено:');
const netOf = (body: string) => {
  const m = /Нетен резултат (-?[\d\s ]+) лв/.exec(body);
  return m ? Number(m[1]!.replace(/[\s ]/g, '')) : 0;
};

export function digest<T extends { title: string; body: string; createdAt: Date }>(list: readonly T[]): DigestItem<T>[] {
  const out: DigestItem<T>[] = [];
  for (const n of list) {
    const day = sofiaDay(n.createdAt);
    const last = out.at(-1);
    if (isArrival(n.title) && last && last.day === day && last.items.every((x) => isArrival(x.title))) {
      last.items.push(n);
      last.kind = 'group';
      last.count++;
      last.netLv += netOf(n.body);
    } else out.push({ kind: 'one', items: [n], day, count: 1, netLv: isArrival(n.title) ? netOf(n.body) : 0 });
  }
  return out;
}
