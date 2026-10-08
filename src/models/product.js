const mongoose = require("mongoose");

const productSchema = new mongoose.Schema({
  name: { type: String, required: true },
  price: { type: Number, required: true },
  image: { type: String, required: true },   // e.g. "hoodie1.webp"
  category: { type: String, enum: ["men", "women", "kids"], default: "men" },
  type: { type: String },                    // hoodie, bottomwear, etc.
  sizes: [String]
});

module.exports = mongoose.models.Product || mongoose.model("Product", productSchema);