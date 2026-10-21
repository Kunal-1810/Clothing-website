const dns = require("node:dns");
dns.setServers(["8.8.8.8", "1.1.1.1"]);
dns.setDefaultResultOrder("ipv4first");

require("dotenv").config();

// ---- TEMPORARY DEBUG: remove once the DB connects ----
console.log(
  "URI loaded:",
  process.env.MONGODB_URI?.replace(/:([^:@]+)@/, ":****@")
);
// ------------------------------------------------------

const express = require("express");
const path = require("path");
const hbs = require("hbs");
const session = require("express-session");
const { MongoStore } = require("connect-mongo");
const bcrypt = require("bcryptjs");

const connectDB = require("./db/conn");
const User = require("./models/user");
const Product = require("./models/product");
const Order = require("./models/order");
const { ensureSeeded } = require("./lib/seed");
const cartLib = require("./lib/cart");
const {
  isObjectId, sizesFor, withSizes, cartCount, clampQty,
  addToCart, setQty, removeItem, buildCart,
} = cartLib;

const app = express();
const port = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === "production";
const debugErrors = process.env.DEBUG_ERRORS === "true";

const static_path = path.join(__dirname, "../public");
const template_path = path.join(__dirname, "./templates/views");
const partials_path = path.join(__dirname, "./templates/partials");

app.set("trust proxy", 1);

// Base URL of the site. Optionally set SITE_URL in Vercel env vars
// (e.g. https://clothing-website-delta-three.vercel.app) to force a fixed domain.
const baseUrl = (req) =>
  (process.env.SITE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/$/, "");

// ---------- robots.txt and sitemap.xml (served by Express, before static files) ----------
app.get("/robots.txt", (req, res) => {
  res
    .type("text/plain")
    .send(
      `User-agent: *\nAllow: /\nDisallow: /cart\nDisallow: /checkout\nDisallow: /orders\nDisallow: /profile\n\nSitemap: ${baseUrl(req)}/sitemap.xml\n`
    );
});

app.get("/sitemap.xml", async (req, res) => {
  const base = baseUrl(req);
  const urls = [
    "/",
    "/men",
    "/women",
    "/kids",
    "/products",
    "/about",
  ].map((p) => `${base}${p === "/" ? "/" : p}`);

  // Add every product page; if the DB is unavailable, still serve the static pages
  try {
    await connectDB();
    const products = await Product.find({}, "_id").lean();
    products.forEach((p) => urls.push(`${base}/products/${p._id}`));
  } catch (err) {
    console.error("Sitemap: could not load products:", err);
  }

  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    urls.map((u) => `  <url><loc>${u}</loc></url>`).join("\n") +
    `\n</urlset>\n`;

  res.type("application/xml").send(xml);
});

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(static_path));
app.set("view engine", "hbs");
app.set("views", template_path);
hbs.registerPartials(partials_path);

// ---------- Template helpers ----------
hbs.registerHelper("money", (n) => Number(n || 0).toLocaleString("en-IN"));
hbs.registerHelper("date", (d) =>
  d
    ? new Date(d).toLocaleDateString("en-IN", {
        day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata",
      })
    : ""
);

// ---------- Fail clearly if env vars are missing ----------
const missingEnv = ["MONGODB_URI", "SESSION_SECRET"].filter(
  (k) => !process.env[k]
);
if (missingEnv.length) {
  console.error("Missing environment variables:", missingEnv.join(", "));
  app.use((req, res) =>
    res
      .status(500)
      .send(
        debugErrors
          ? "Missing environment variables: " + missingEnv.join(", ")
          : "Server is not configured correctly"
      )
  );
  module.exports = app;
  if (require.main === module) {
    app.listen(port, () => console.log(`Server is running on port ${port}`));
  }
  return;
}

// ---------- Connect Mongoose BEFORE anything else touches the DB ----------
app.use(async (req, res, next) => {
  try {
    await connectDB();
  } catch (err) {
    console.error("DB connection failed:", err);
    return res
      .status(500)
      .send(debugErrors ? "DB error: " + err.message : "Something went wrong");
  }
  // Add any missing starter products (once per server start). Never blocks the site.
  try {
    await ensureSeeded();
  } catch (err) {
    console.error("Seeding products failed:", err);
  }
  next();
});

app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    store: MongoStore.create({ mongoUrl: process.env.MONGODB_URI }),
    cookie: {
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 1000 * 60 * 60 * 24,
    },
  })
);

app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.cartCount = cartCount(req.session.cart);
  next();
});

const saveSession = (req) =>
  new Promise((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve()))
  );

const serverError = (res, label, err) => {
  console.error(label, err);
  res
    .status(500)
    .send(debugErrors ? "Error: " + err.message : "Something went wrong");
};

// Send people to login if they are not logged in, and remember where they wanted to go
const requireLogin = (req, res, next) => {
  if (req.session.user) return next();
  req.session.returnTo = req.originalUrl;
  req.session.save(() => res.redirect("/login"));
};
const redirectIfLoggedIn = (req, res, next) =>
  req.session.user ? res.redirect("/") : next();

const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const capitalise = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ---------- Pages ----------
const isHoodie = (p) => /^hoodie$/i.test(p.type || "") || /^hoodie/i.test(p.image || "");
const isBottomwear = (p) =>
  /^bottomwear$/i.test(p.type || "") || /^bottomwear/i.test(p.image || "");

app.get("/", async (req, res) => {
  let hoodies = [];
  let bottomwear = [];
  try {
    const men = await Product.find({ category: "men" }).sort({ _id: 1 }).lean();
    hoodies = withSizes(men.filter(isHoodie).slice(0, 5));
    bottomwear = withSizes(men.filter(isBottomwear).slice(0, 5));
  } catch (err) {
    console.error("GET / failed:", err);
  }
  res.render("home", { hoodies, bottomwear });
});

app.get("/about", (req, res) => res.render("about"));
app.get("/login", redirectIfLoggedIn, (req, res) => res.render("login"));
app.get("/register", redirectIfLoggedIn, (req, res) => res.render("register"));

// ---------- Category pages: /men /women /kids (read from the database) ----------
const CATEGORIES = {
  men: {
    heading: "Men",
    tagline: "Hoodies, tees and jackets for men",
    title: "Men's Clothing - Shop Shirts, T-Shirts & Jeans Online | The Clothing Loop",
    description:
      "Shop stylish men's clothing online. Browse shirts, t-shirts, jeans and more at The Clothing Loop with easy ordering.",
    keywords:
      "shop clothes online, clothing collection, shirts, jeans, t-shirts, menswear, best collections, best men collections, buy fashion online, men's fashion online, men's apparel, men's clothing, casual wear for men, formal wear for men, online shopping for men, trendy men's clothing, affordable men's fashion",
  },
  women: {
    heading: "Women",
    tagline: "Tops, dresses and everyday essentials",
    title: "Women's Clothing - Shop Dresses, Tops & Jeans Online | The Clothing Loop",
    description:
      "Shop trendy women's clothing online. Browse dresses, tops, jeans and more at The Clothing Loop with easy ordering.",
    keywords:
      "shop clothes online, clothing collection, shirts, jeans, dresses, womenswear, best collections, best women collections, buy fashion online, women's fashion online, women's apparel, women's clothing, casual wear for women, formal wear for women, online shopping for women, trendy women's clothing, affordable women's fashion",
  },
  kids: {
    heading: "Kids",
    tagline: "Comfortable and colourful clothes for kids",
    title: "Kids Clothing - Shop Boys & Girls Wear Online | The Clothing Loop",
    description:
      "Shop comfortable and stylish clothing for kids online. Browse tees, dresses, jeans and more for boys and girls at The Clothing Loop.",
    keywords:
      "shop clothes online, clothing collection, shirts, jeans, dresses, kidswear, best collections, best kids collections, buy fashion online, children's wear, kids fashion online, baby clothes, toddler clothing, kids apparel, boys clothing, girls clothing",
  },
};

Object.entries(CATEGORIES).forEach(([key, meta]) => {
  // old links like /men.html keep working and point search engines to /men
  app.get(`/${key}.html`, (req, res) => res.redirect(301, `/${key}`));

  app.get(`/${key}`, async (req, res) => {
    try {
      const q = (req.query.q || "").toString().trim().slice(0, 60);
      const filter = { category: key };
      if (q) {
        const rx = new RegExp(escapeRegex(q), "i");
        filter.$or = [{ name: rx }, { type: rx }];
      }
      const products = await Product.find(filter).sort({ _id: 1 }).lean();
      res.render("category", {
        category: key,
        meta,
        query: q,
        products,
        canonical: `${baseUrl(req)}/${key}`,
      });
    } catch (err) {
      serverError(res, `GET /${key} failed:`, err);
    }
  });
});

// ---------- Products (public: anyone can browse, login is needed at checkout) ----------
app.get("/products", async (req, res) => {
  try {
    const q = (req.query.q || "").toString().trim();
    let filter = {};
    if (q) {
      // escape regex special characters so the search can't break
      const rx = new RegExp(escapeRegex(q), "i");
      filter = { $or: [{ name: rx }, { type: rx }, { category: rx }] };
    }
    const products = await Product.find(filter).sort({ _id: 1 }).lean();
    res.render("products", { products: withSizes(products), query: q });
  } catch (err) {
    serverError(res, "GET /products failed:", err);
  }
});

const describe = (p) =>
  p.description ||
  `${p.name} from The Clothing Loop's ${p.category || "latest"} collection. Comfortable, well-made and easy to wear every day.`;

// Product details page: one page per product
app.get("/products/:id", async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) {
      return res.status(404).send("Product not found");
    }
    const product = await Product.findById(req.params.id).lean();
    if (!product) return res.status(404).send("Product not found");

    const related = await Product.find({
      category: product.category,
      _id: { $ne: product._id },
    })
      .sort({ _id: 1 })
      .limit(4)
      .lean();

    const base = baseUrl(req);
    const description = describe(product);
    const imageUrl = `${base}/${encodeURI(product.image)}`;
    const canonical = `${base}/products/${product._id}`;

    // structured data so Google can show price in search results
    const jsonLd = JSON.stringify({
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      image: imageUrl,
      description,
      category: product.category,
      brand: { "@type": "Brand", name: "The Clothing Loop" },
      offers: {
        "@type": "Offer",
        priceCurrency: "INR",
        price: String(product.price),
        availability: "https://schema.org/InStock",
        url: canonical,
      },
    }).replace(/</g, "\\u003c");

    res.render("product-details", {
      product,
      sizes: sizesFor(product),
      description,
      categoryLabel: capitalise(product.category),
      related,
      canonical,
      imageUrl,
      jsonLd,
    });
  } catch (err) {
    serverError(res, "GET /products/:id failed:", err);
  }
});

// ---------- Cart (works for guests too; it lives in the session) ----------
app.get("/cart", async (req, res) => {
  try {
    const cart = await buildCart(req.session);
    res.render("cart", { cart });
  } catch (err) {
    serverError(res, "GET /cart failed:", err);
  }
});

app.post("/cart/add", async (req, res) => {
  const wantsJson = req.accepts(["html", "json"]) === "json";
  const fail = (status, message) =>
    wantsJson ? res.status(status).json({ ok: false, error: message }) : res.redirect(
      isObjectId(req.body.productId) ? `/products/${req.body.productId}` : "/products"
    );
  try {
    const { productId, size } = req.body;
    if (!isObjectId(productId)) return fail(400, "Invalid product");

    const product = await Product.findById(productId).lean();
    if (!product) return fail(404, "Product not found");
    if (!sizesFor(product).includes(size)) return fail(400, "Please select a size");

    addToCart(req.session, String(product._id), size, clampQty(req.body.qty));
    await saveSession(req);

    if (wantsJson) return res.json({ ok: true, count: cartCount(req.session.cart) });
    res.redirect(req.body.buyNow ? "/checkout" : "/cart");
  } catch (err) {
    console.error("POST /cart/add failed:", err);
    if (wantsJson) return res.status(500).json({ ok: false, error: "Something went wrong" });
    res.status(500).send("Something went wrong");
  }
});

app.post("/cart/update", async (req, res) => {
  try {
    const { productId, size } = req.body;
    if (isObjectId(productId)) {
      setQty(req.session, productId, size, parseInt(req.body.qty, 10) || 0);
      await saveSession(req);
    }
    res.redirect("/cart");
  } catch (err) {
    serverError(res, "POST /cart/update failed:", err);
  }
});

app.post("/cart/remove", async (req, res) => {
  try {
    const { productId, size } = req.body;
    if (isObjectId(productId)) {
      removeItem(req.session, productId, size);
      await saveSession(req);
    }
    res.redirect("/cart");
  } catch (err) {
    serverError(res, "POST /cart/remove failed:", err);
  }
});

// ---------- Checkout (login required) ----------
app.get("/checkout", requireLogin, async (req, res) => {
  try {
    const cart = await buildCart(req.session);
    if (!cart.lines.length) return res.redirect("/cart");
    res.render("checkout", { cart, form: { fullName: req.session.user.name } });
  } catch (err) {
    serverError(res, "GET /checkout failed:", err);
  }
});

app.post("/checkout", requireLogin, async (req, res) => {
  try {
    const cart = await buildCart(req.session);
    if (!cart.lines.length) return res.redirect("/cart");

    const pick = (k, max = 120) => String(req.body[k] || "").trim().slice(0, max);
    const form = {
      fullName: pick("fullName", 80),
      phone: pick("phone", 15).replace(/[\s-]/g, ""),
      line1: pick("line1", 200),
      city: pick("city", 60),
      state: pick("state", 60),
      pincode: pick("pincode", 6),
    };

    let error = null;
    if (!form.fullName || !form.line1 || !form.city || !form.state) {
      error = "Please fill in all the delivery details";
    } else if (!/^(\+91)?[6-9]\d{9}$/.test(form.phone)) {
      error = "Enter a valid 10-digit mobile number";
    } else if (!/^\d{6}$/.test(form.pincode)) {
      error = "Enter a valid 6-digit PIN code";
    }
    if (error) return res.status(400).render("checkout", { cart, form, error });

    const order = await Order.create({
      user: req.session.user.id,
      items: cart.lines.map((l) => ({
        product: l.productId,
        name: l.name,
        image: l.image,
        size: l.size,
        price: l.price,
        qty: l.qty,
      })),
      shippingAddress: form,
      paymentMethod: "cod",
      subtotal: cart.subtotal,
      shipping: cart.shipping,
      total: cart.total,
    });

    req.session.cart = [];
    await saveSession(req);
    res.redirect(`/orders/${order._id}?placed=1`);
  } catch (err) {
    serverError(res, "POST /checkout failed:", err);
  }
});

// ---------- Orders (login required) ----------
const decorateOrder = (o) => ({
  ...o,
  orderNo: String(o._id).slice(-8).toUpperCase(),
  items: o.items.map((i) => ({ ...i, lineTotal: i.price * i.qty })),
});

app.get("/orders", requireLogin, async (req, res) => {
  try {
    const orders = await Order.find({ user: req.session.user.id })
      .sort({ createdAt: -1 })
      .lean();
    res.render("orders", { orders: orders.map(decorateOrder) });
  } catch (err) {
    serverError(res, "GET /orders failed:", err);
  }
});

app.get("/orders/:id", requireLogin, async (req, res) => {
  try {
    if (!isObjectId(req.params.id)) return res.status(404).send("Order not found");
    const order = await Order.findOne({
      _id: req.params.id,
      user: req.session.user.id,
    }).lean();
    if (!order) return res.status(404).send("Order not found");
    res.render("order", { order: decorateOrder(order), placed: req.query.placed === "1" });
  } catch (err) {
    serverError(res, "GET /orders/:id failed:", err);
  }
});

// ---------- Profile ----------
app.get("/profile", requireLogin, async (req, res) => {
  try {
    const dbUser = await User.findById(req.session.user.id)
      .select("-password")
      .lean();

    if (!dbUser) {
      return req.session.destroy(() => {
        res.clearCookie("connect.sid");
        res.redirect("/login");
      });
    }

    res.render("profile", { profile: dbUser });
  } catch (err) {
    console.error(err);
    res.redirect("/");
  }
});

// ---------- Auth ----------
app.post("/register", redirectIfLoggedIn, async (req, res) => {
  try {
    const { name, email, password, confirmPassword } = req.body;

    if (!name || !email || !password) {
      return res.render("register", { error: "Please fill in all fields" });
    }
    if (password !== confirmPassword) {
      return res.render("register", { error: "Passwords do not match" });
    }

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      return res.render("register", { error: "Email is already registered" });
    }

    const hashed = await bcrypt.hash(password, 10);
    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashed,
    });

    // regenerate() wipes the session, so keep returnTo and the cart first
    const returnTo = req.session.returnTo || "/products";
    const cart = req.session.cart;
    req.session.regenerate((err) => {
      if (err) {
        return res.render("register", { error: "Something went wrong. Try again." });
      }
      req.session.user = { id: user._id, name: user.name, email: user.email };
      if (cart && cart.length) req.session.cart = cart;
      req.session.save(() => res.redirect(returnTo));
    });
  } catch (err) {
    console.error(err);
    res.render("register", { error: "Something went wrong. Try again." });
  }
});

app.post("/login", redirectIfLoggedIn, async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.render("login", { error: "Invalid email or password" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    const ok = user && (await bcrypt.compare(password, user.password));

    if (!ok) {
      return res.render("login", { error: "Invalid email or password" });
    }

    // regenerate() wipes the session, so keep returnTo and the cart first
    const returnTo = req.session.returnTo || "/products";
    const cart = req.session.cart;
    req.session.regenerate((err) => {
      if (err) {
        return res.render("login", { error: "Login failed. Try again." });
      }
      req.session.user = { id: user._id, name: user.name, email: user.email };
      if (cart && cart.length) req.session.cart = cart;
      req.session.save(() => res.redirect(returnTo));
    });
  } catch (err) {
    console.error(err);
    res.render("login", { error: "Something went wrong. Try again." });
  }
});

app.post("/logout", requireLogin, (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("connect.sid");
    res.redirect("/");
  });
});

// ---------- 404 (keep this last) ----------
app.use((req, res) => res.status(404).send("Page not found"));

// Run a normal server locally; on Vercel the app is exported instead
if (require.main === module) {
  app.listen(port, () => console.log(`Server is running on port ${port}`));
}

module.exports = app;