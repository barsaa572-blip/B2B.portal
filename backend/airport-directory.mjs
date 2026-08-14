/**
 * Airport lookup data for autocomplete.
 * Source: OurAirports (Public Domain), refreshed at process startup as needed.
 * https://ourairports.com/data/
 */
const DATA_URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
let directoryPromise;

const parseCsvLine = line => {
  const fields = []; let value = ''; let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) { fields.push(value); value = ''; }
    else value += character;
  }
  fields.push(value);
  return fields;
};

async function loadDirectory() {
  const response = await fetch(DATA_URL, { headers: { accept: 'text/csv' } });
  if (!response.ok) throw new Error(`Airport directory download failed (${response.status}).`);
  const lines = (await response.text()).split(/\r?\n/);
  const columns = parseCsvLine(lines.shift() || '');
  const position = name => columns.indexOf(name);
  const read = (row, name) => row[position(name)] || '';
  const airports = lines.flatMap(line => {
    if (!line) return [];
    const row = parseCsvLine(line);
    const code = read(row, 'iata_code').trim().toUpperCase();
    const type = read(row, 'type');
    if (!/^[A-Z]{3}$/.test(code) || read(row, 'scheduled_service') !== 'yes' || !['large_airport', 'medium_airport', 'small_airport'].includes(type) || code === 'UBN') return [];
    return [{ code, city: read(row, 'municipality') || read(row, 'name'), airport: read(row, 'name'), country: read(row, 'iso_country') }];
  });
  // Spring's gateway expects ULN, so keep this alias stable even if public IATA
  // data changes it to UBN.
  airports.unshift({ code: 'ULN', city: 'Ulaanbaatar', airport: 'Chinggis Khaan International Airport', country: 'MN' });
  return airports;
}

const getDirectory = () => directoryPromise ||= loadDirectory();

export async function searchAirports(query, limit = 10) {
  const text = String(query || '').trim().toLowerCase();
  if (text.length < 2) return [];
  const airports = await getDirectory();
  const rank = airport => {
    const code = airport.code.toLowerCase(); const city = airport.city.toLowerCase(); const name = airport.airport.toLowerCase();
    if (code === text) return 0;
    if (code.startsWith(text) || city.startsWith(text)) return 1;
    if (name.startsWith(text)) return 2;
    return 3;
  };
  return airports.filter(airport => `${airport.code} ${airport.city} ${airport.airport} ${airport.country}`.toLowerCase().includes(text)).sort((left, right) => rank(left) - rank(right) || left.city.localeCompare(right.city)).slice(0, limit);
}
