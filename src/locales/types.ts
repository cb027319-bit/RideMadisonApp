/** A translation must provide every key of the English namespace. */
export type Dict<T> = { [K in keyof T]: string };
