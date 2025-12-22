const express = require("express");
const stripe = require("stripe");
const session = require("express-session");
const bodyParser = require("body-parser");
const dotenv = require("dotenv");
const fs = require("fs");
const path = require("path");

dotenv.config();

const app = express();
const stripeClient = stripe(process.env.STRIPE_SECRET_KEY);
const STRIPE_PUBLISHABLE_KEY = process.env.STRIPE_PUBLISHABLE_KEY || "pk_test_...";

app.set("view engine", "ejs");
app.set("views", path.join(__dirname, "views"));
app.use(express.static(path.join(__dirname, "public")));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.json());

app.use(
  session({
    secret: "your-secret-key",
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
  })
);

// Загружаем товары
const products = JSON.parse(
  fs.readFileSync(path.join(__dirname, "data/products.json"), "utf8")
);

// === МАРШРУТЫ ===

app.get("/", (req, res) => {
  res.render("index", { 
    title: 'Alain Robyn',
    user: req.session.user || null,
    cart: req.session.cart || []
  });
});

app.get("/catalog", (req, res) => {
  let filteredProducts = [...products];
  
  if (req.query.category && req.query.category !== 'all') {
    filteredProducts = filteredProducts.filter(p => p.category === req.query.category);
  }
  
  if (req.query.type && req.query.type !== 'all') {
    filteredProducts = filteredProducts.filter(p => p.type === req.query.type);
  }
  
  res.render("catalog", { 
    title: 'Каталог | Alain Robyn',
    products: filteredProducts,
    user: req.session.user || null,
    cart: req.session.cart || []
  });
});

app.get("/buyer-dashboard", (req, res) => {
  if (!req.session.user || req.session.user.role !== 'buyer') {
    return res.redirect("/catalog");
  }

  res.render("buyer-dashboard", {
    title: 'Оптовый кабинет | Alain Robyn',
    user: req.session.user,
    cart: req.session.cart || []
  });
});

// Добавление в корзину (розница) — AJAX
app.post("/add-to-cart", (req, res) => {
  if (!req.session.cart) req.session.cart = [];

  const product = products.find(p => p.id == req.body.id);
  if (!product) {
    return res.json({ success: false });
  }

  const existing = req.session.cart.find(item => item.id == product.id);
  if (existing) {
    existing.qty += 1;
  } else {
    req.session.cart.push({ ...product, qty: 1 });
  }

  res.json({ success: true });
});

// Оптовое добавление
app.post("/add-bulk-to-cart", (req, res) => {
  if (!req.session.cart) req.session.cart = [];

  const { productId, productName, image, items } = req.body;

  const baseProduct = products.find(p => p.id == productId);
  if (!baseProduct) {
    return res.json({ success: false });
  }

  const totalQty = items.reduce((sum, item) => sum + parseInt(item.qty), 0);
  const totalWholesale = items.reduce((sum, item) => sum + parseInt(item.qty) * parseFloat(item.price), 0);

  const bulkItem = {
    id: `bulk-${baseProduct.id}-${Date.now()}`,
    name: `${productName} (оптовый заказ)`,
    price: baseProduct.price,
    image: image || baseProduct.image,
    qty: totalQty,
    isBulk: true,
    bulkDetails: items,
    bulkTotal: totalWholesale
  };

  req.session.cart.push(bulkItem);

  res.json({ success: true });
});

app.post("/remove-from-cart", (req, res) => {
  if (req.session.cart) {
    req.session.cart = req.session.cart.filter(item => item.id != req.body.id);
  }
  res.redirect("/cart");
});

app.post("/update-cart-quantity", (req, res) => {
  if (!req.session.cart) req.session.cart = [];

  const { id, qty } = req.body;
  const item = req.session.cart.find(item => item.id == id);

  if (item && qty > 0) {
    item.qty = parseInt(qty);
  } else if (item) {
    req.session.cart = req.session.cart.filter(i => i.id != id);
  }

  const total = req.session.cart.reduce((sum, i) => sum + i.price * i.qty, 0);
  res.json({ success: true, total: total.toFixed(2) });
});

app.get("/wishlist", (req, res) => {
  res.render("wishlist", { 
    title: 'Wishlist | Alain Robyn',
    user: req.session.user || null,
    cart: req.session.cart || []
  });
});

app.get("/cart", (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  res.render("cart", { 
    title: 'Корзина | Alain Robyn',
    cart, 
    total, 
    user: req.session.user || null
  });
});



app.get("/checkout", (req, res) => {
  const cart = req.session.cart || [];
  const total = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  res.render("checkout", {
    title: 'Оформление заказа | Alain Robyn',
    total,
    publishableKey: STRIPE_PUBLISHABLE_KEY,
    user: req.session.user || null,
    cart
  });
});

app.post("/create-checkout-session", async (req, res) => {
  const cart = req.session.cart || [];
  const lineItems = cart.map(item => ({
    price_data: {
      currency: "eur",
      product_data: { name: item.name },
      unit_amount: Math.round(item.price * 100)
    },
    quantity: item.qty
  }));

  const session = await stripeClient.checkout.sessions.create({
    payment_method_types: ["card"],
    line_items: lineItems,
    mode: "payment",
    success_url: "http://localhost:3000/success",
    cancel_url: "http://localhost:3000/cart"
  });

  res.json({ id: session.id });
});

app.get("/success", (req, res) => {
  req.session.cart = [];
  res.render("success", { 
    title: 'Успех',
    user: req.session.user || null,
    cart: []
  });
});

app.get("/product/:id", (req, res) => {
  const product = products.find(p => p.id == req.params.id);
  if (!product) {
    return res.status(404).render("404", { 
      title: '404',
      user: req.session.user || null,
      cart: req.session.cart || []
    });
  }
  res.render("product", { 
    title: product.name,
    product, 
    user: req.session.user || null,
    cart: req.session.cart || []
  });
});

app.get("/rewards", (req, res) => {
  res.render("rewards", { 
    title: 'Community Rewards | Alain Robyn',
    user: req.session.user || null,
    cart: req.session.cart || []
  });
});

app.get("/login", (req, res) => {
  res.render("login", { 
    title: 'Вход | Alain Robyn',
    user: req.session.user || null,
    cart: req.session.cart || []
  });
});

app.get("/register", (req, res) => {
  res.render("register", { 
    title: 'Регистрация | Alain Robyn',
    user: req.session.user || null,
    cart: req.session.cart || []
  });
});

// Логин — обычный редирект (как было)
app.post("/login", (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.redirect("/login?error=empty");
  }

  const isTestBuyer = email.includes("buyer") || email.includes("опт");

  req.session.user = {
    name: email.split("@")[0],
    email: email.toLowerCase(),
    role: isTestBuyer ? "buyer" : "customer",
    discount: isTestBuyer ? 25 : 0
  };

  res.redirect("/catalog");
});

// Регистрация — обычный редирект
app.post("/register", (req, res) => {
  const { name, email, password, isBuyer } = req.body;

  if (!email || !password || !name) {
    return res.redirect("/register?error=empty");
  }

  req.session.user = {
    name: name.trim(),
    email: email.toLowerCase(),
    role: isBuyer ? "buyer" : "customer",
    discount: isBuyer ? 20 : 0
  };

  res.redirect("/catalog");
});

app.get("/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/");
  });
});

app.use((req, res) => {
  res.status(404).render("404", { 
    title: '404',
    user: req.session.user || null,
    cart: req.session.cart || []
  });
});

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});