export function formatCountry(countryCode?: string | null): string {
  const code = countryCode?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code)) return "-";
  try {
    const name = new Intl.DisplayNames(["fr", "en"], { type: "region" }).of(code);
    return name ? `${countryFlag(code)} ${name}` : code;
  } catch {
    return code;
  }
}

function countryFlag(countryCode: string): string {
  return String.fromCodePoint(...countryCode.split("").map((letter) => 127397 + letter.charCodeAt(0)));
}
