const Product = require("../models/product");

// ---- Store settings: change these numbers to suit your store ----
const MAX_QTY = 10;               // max of one product + size in the cart
const FREE_SHIPPING_ABOVE = 1999; // free delivery when subtotal reaches this (Rs)
const SHIPPING_FEE = 99;          // otherwise this flat fee (Rs)
// ------------------------------------------------------------------

const ID_RE = /^[0-9a-fA-F]{24}$/;
const isObjectId = (v) => typeof v === "string" && ID_RE.test(v);

// Used when a product in the database has no sizes saved
function sizesFor(product) {
  if (product.sizes && product.sizes.length) return product.sizes;
  return product.category === "kids"
    ? ["2-3Y", "4-5Y", "6-7Y", "8-9Y"]
    : ["S", "M", "L", "XL"];
}

const withSizes = (products) => products.map((p) => ({ ...p, sizes: sizesFor(p) }));

const cartCount = (cart) => (cart || []).reduce((n, i) => n + i.qty, 0);

const clampQty = (value) => {
  const n = parseInt(value, 10);
  if (!Number.isInteger(n)) return 1;
  return Math.max(1, Math.min(MAX_QTY, n));
};

function addToCart(session, productId, size, qty) {
  if (!session.cart) session.cart = [];
  const found = session.cart.find((i) => i.productId === productId && i.size === size);
  if (found) found.qty = Math.min(MAX_QTY, found.qty + qty);
  else session.cart.push({ productId, size, qty: Math.min(MAX_QTY, qty) });
}

function removeItem(session, productId, size) {
  session.cart = (session.cart || []).filter(
    (i) => !(i.productId === productId && i.size === size)
  );
}

function setQty(session, productId, size, qty) {
  const item = (session.cart || []).find((i) => i.productId === productId && i.size === size);
  if (!item) return;
  if (qty <= 0) removeItem(session, productId, size);
  else item.qty = Math.min(MAX_QTY, qty);
}

// Reads the session cart and prices it from the database (never trusts the browser for prices)
async function buildCart(session) {
  const raw = (session.cart || []).filter((i) => isObjectId(i.productId));
  const ids = [...new Set(raw.map((i) => i.productId))];
  const products = ids.length ? await Product.find({ _id: { $in: ids } }).lean() : [];
  const byId = new Map(products.map((p) => [String(p._id), p]));

  const lines = [];
  const kept = [];
  for (const item of raw) {
    const p = byId.get(item.productId);
    if (!p) continue; // product was deleted from the database
    kept.push(item);
    lines.push({
      productId: item.productId,
      name: p.name,
      image: p.image,
      size: item.size,
      price: p.price,
      qty: item.qty,
      lineTotal: p.price * item.qty,
      minusQty: item.qty - 1,
      plusQty: Math.min(MAX_QTY, item.qty + 1),
      canIncrease: item.qty < MAX_QTY,
    });
  }
  if (kept.length !== (session.cart || []).length) session.cart = kept;

  const subtotal = lines.reduce((sum, l) => sum + l.lineTotal, 0);
  const shipping = !subtotal || subtotal >= FREE_SHIPPING_ABOVE ? 0 : SHIPPING_FEE;
  return {
    lines,
    count: lines.reduce((n, l) => n + l.qty, 0),
    subtotal,
    shipping,
    total: subtotal + shipping,
    amountForFreeShipping:
      subtotal && subtotal < FREE_SHIPPING_ABOVE ? FREE_SHIPPING_ABOVE - subtotal : 0,
  };
}

module.exports = {
  MAX_QTY, isObjectId, sizesFor, withSizes, cartCount, clampQty,
  addToCart, setQty, removeItem, buildCart,
};
