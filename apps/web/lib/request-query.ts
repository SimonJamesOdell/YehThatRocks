type ParseClampedIntParamOptions = {
  defaultValue: number;
  min: number;
  max?: number;
};

export function parseClampedIntParam(
  searchParams: URLSearchParams,
  name: string,
  options: ParseClampedIntParamOptions,
) {
  const parsed = Number(searchParams.get(name) ?? String(options.defaultValue));
  const baseValue = Number.isFinite(parsed) ? parsed : options.defaultValue;
  const flooredValue = Math.floor(baseValue);
  const minClampedValue = Math.max(options.min, flooredValue);

  if (typeof options.max === "number" && Number.isFinite(options.max)) {
    return Math.min(options.max, minClampedValue);
  }

  return minClampedValue;
}