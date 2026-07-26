export function substituteVariables(value: string, variables: Readonly<Record<string, string>>): string {
  return value.replace(/\$\{([a-zA-Z]+)\}/gu, (match, name: string) => variables[name] ?? match);
}
