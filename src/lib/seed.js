const Product = require("../models/product");

const S = ["S", "M", "L", "XL"];
const K = ["2-3Y", "4-5Y", "6-7Y", "8-9Y"];

// Starter catalogue. Each product is matched by its image file name, so a product
// that already exists in your database is left exactly as it is.
const SEED = [
  // ---- Men ----
  { name: "Web Crest Black Hoodie", price: 1999, image: "hoodie1.webp", category: "men", type: "hoodie", sizes: S },
  { name: "Faded Black Hoodie", price: 1699, image: "hoodie2.webp", category: "men", type: "hoodie", sizes: S },
  { name: "Iron Man Oversized Hoodie", price: 1599, image: "hoodie3.webp", category: "men", type: "hoodie", sizes: S },
  { name: "Grey Wear A Hug Oversized Hoodie", price: 1599, image: "hoodie4.webp", category: "men", type: "hoodie", sizes: S },
  { name: "Playboy Muse Oversized Hoodie", price: 1599, image: "hoodie5.webp", category: "men", type: "hoodie", sizes: S },
  { name: "Black Loose Fit Joggers", price: 1299, image: "Bottomwear1.webp", category: "men", type: "bottomwear", sizes: S },
  { name: "Cloudy Everyday Joggers", price: 1399, image: "Bottomwear2.webp", category: "men", type: "bottomwear", sizes: S },
  { name: "Driftwood 6 Pockets Cargo Pant", price: 1399, image: "Bottomwear3.webp", category: "men", type: "bottomwear", sizes: S },
  { name: "Hustle The Untamed White Joggers", price: 1599, image: "Bottomwear4.webp", category: "men", type: "bottomwear", sizes: S },
  { name: "Espresso Brown Wide-Leg Sweatpants", price: 1199, image: "Bottomwear5.webp", category: "men", type: "bottomwear", sizes: S },
  // ---- Women ----
  { name: "Crop top", price: 699, image: "btmwear1.webp", category: "women", type: "topwear", sizes: S },
  { name: "Floral dress", price: 1899, image: "btmwear2.webp", category: "women", type: "dress", sizes: S },
  { name: "Oversized hoodie", price: 1599, image: "btmwear3.webp", category: "women", type: "hoodie", sizes: S },
  { name: "High-waist jeans", price: 1499, image: "btmwear4.webp", category: "women", type: "bottomwear", sizes: S },
  { name: "Knit cardigan", price: 1699, image: "btmwear5.webp", category: "women", type: "topwear", sizes: S },
  { name: "Midi skirt", price: 1199, image: "btmwear6.webp", category: "women", type: "bottomwear", sizes: S },
  { name: "Co-ord set", price: 2199, image: "btmwear7.webp", category: "women", type: "set", sizes: S },
  { name: "Leggings", price: 899, image: "btmwear8.webp", category: "women", type: "bottomwear", sizes: S },
  // ---- Kids ----
  { name: "Cartoon t-shirt", price: 499, image: "kids1.webp", category: "kids", type: "tshirt", sizes: K },
  { name: "Kids hoodie", price: 999, image: "kids2.webp", category: "kids", type: "hoodie", sizes: K },
  { name: "Denim dungarees", price: 1199, image: "kids3.webp", category: "kids", type: "bottomwear", sizes: K },
  { name: "Shorts set", price: 799, image: "kids4.webp", category: "kids", type: "set", sizes: K },
  { name: "Party frock", price: 1299, image: "kids5.jpg", category: "kids", type: "dress", sizes: K },
  { name: "Joggers", price: 699, image: "kids6.webp", category: "kids", type: "bottomwear", sizes: K },
  { name: "Winter jacket", price: 1599, image: "kids7.webp", category: "kids", type: "jacket", sizes: K },
  { name: "Pyjama set", price: 899, image: "kids8.webp", category: "kids", type: "set", sizes: K },
];

let seeding = null;

// Adds any product from SEED that is missing from the database. Runs once per server start.
function ensureSeeded() {
  if (!seeding) {
    seeding = Product.bulkWrite(
      SEED.map(({ image, ...rest }) => ({
        updateOne: {
          filter: { image },
          update: { $setOnInsert: rest },
          upsert: true,
        },
      }))
    ).catch((err) => {
      seeding = null; // try again on the next request
      throw err;
    });
  }
  return seeding;
}

module.exports = { ensureSeeded, SEED };
