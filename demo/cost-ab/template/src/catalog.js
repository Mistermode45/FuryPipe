/**
 * Product catalog + line-item resolution.
 *
 * The pricing engine works on `{ cents, qty }` line items; in the app those come
 * from resolving SKUs against this catalog. Prices are in integer cents.
 */
export const CATALOG = {
  'SKU-COFFEE-250': { name: 'House blend, 250g', cents: 1299 },
  'SKU-COFFEE-1KG': { name: 'House blend, 1kg', cents: 4499 },
  'SKU-FILTER-100': { name: 'Paper filters (100)', cents: 599 },
  'SKU-MUG-CER': { name: 'Ceramic mug', cents: 1450 },
  'SKU-MUG-TRVL': { name: 'Travel mug', cents: 2200 },
  'SKU-GRINDER-M': { name: 'Manual grinder', cents: 3999 },
  'SKU-GRINDER-E': { name: 'Electric grinder', cents: 8900 },
  'SKU-KETTLE': { name: 'Gooseneck kettle', cents: 6500 },
  'SKU-SCALE': { name: 'Brew scale', cents: 4200 },
  'SKU-DRIPPER': { name: 'Pour-over dripper', cents: 2800 },
  'SKU-CARAFE': { name: 'Glass carafe', cents: 3100 },
  'SKU-BEANS-SUB': { name: 'Monthly beans subscription', cents: 2499 },
  'SKU-DESCALE': { name: 'Descaling solution', cents: 999 },
  'SKU-TAMPER': { name: 'Espresso tamper', cents: 1899 },
  'SKU-CLOTH': { name: 'Microfibre cloth', cents: 450 },
};

/**
 * Resolve `[{ sku, qty }]` against the catalog into pricing line items.
 * @param {{sku:string, qty:number}[]} order
 * @returns {{cents:number, qty:number}[]}
 */
export function toLineItems(order) {
  return order.map(({ sku, qty }) => {
    const entry = CATALOG[sku];
    if (!entry) throw new Error(`unknown SKU: ${sku}`);
    return { cents: entry.cents, qty };
  });
}
