function helper(value: number): number { return value + 1; }
export function run(): number { return helper(41); }
export function View() { return <span>{run()}</span>; }
