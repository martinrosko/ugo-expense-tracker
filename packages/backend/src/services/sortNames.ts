// The Postgres image uses binary collation, so names are sorted here to keep "A" and "a" together
const collator = new Intl.Collator('sk')

export const compareNames = (a: string | null | undefined, b: string | null | undefined) => collator.compare(a ?? '', b ?? '')

export const sortByName = <T extends { name: string | null }>(items: T[]): T[] => items.sort((a, b) => compareNames(a.name, b.name))
