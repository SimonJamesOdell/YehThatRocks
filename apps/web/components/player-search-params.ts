export function clearPlaylistParams(params: URLSearchParams) {
  params.delete("pl");
  params.delete("pli");
  return params;
}

export function clearVideoAndPlaylistParams(params: URLSearchParams) {
  params.delete("v");
  return clearPlaylistParams(params);
}

export function buildPathWithParams(pathname: string, params: URLSearchParams) {
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
