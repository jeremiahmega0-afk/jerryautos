const express = require('express');
const cors    = require('cors');
const app     = express();

app.use(cors());
app.use(express.json());
app.use(express.static('html'));
app.use('/js', express.static('js'));

/* ══════════════════════════════════════════════════════════════
   IN-MEMORY DATABASE
   ─ sellerId    : Firebase UID — sent to buyers too, since chat
                   needs it to start a conversation with the seller
   ─ sellerAlias : Public display name shown to buyers

   NOTE ON SEED DATA: the 4 vehicles below use placeholder sellerIds
   ("seller_abc123", "AlphaDealer", "BestDeals_PH") that are NOT real
   Firebase UIDs. Contacting these sellers will open a chat thread,
   but no real account exists to read/reply — chat.html falls back
   to showing "Seller" as the name. Real vehicles posted through
   seller-dashboard.html use the actual signed-in seller's Firebase
   UID and will work end-to-end.
   ══════════════════════════════════════════════════════════════ */
let vehicles = [
    {
        id: "1", _id: "1",
        sellerId:    "seller_abc123",
        sellerAlias: "Toyota Hub Lagos",
        make: "Toyota", model: "Camry", year: 2021,
        price: 18500000, status: "Available",
        transmission: "Automatic", fuelType: "Petrol",
        mileage: 15400,
        image: "https://images.unsplash.com/photo-1520031441872-265e4ff70366?auto=format&fit=crop&w=600&q=80"
    },
    {
        id: "2", _id: "2",
        sellerId:    "AlphaDealer",
        sellerAlias: "Alpha Motors Abuja",
        make: "Tesla", model: "Model 3", year: 2024,
        price: 65000000, status: "Available",
        transmission: "Automatic", fuelType: "Electric",
        mileage: 120,
        image: "https://images.unsplash.com/photo-1563720223185-11003d516935?auto=format&fit=crop&w=600&q=80"
    },
    {
        id: "3", _id: "3",
        sellerId:    "seller_abc123",
        sellerAlias: "Toyota Hub Lagos",
        make: "Honda", model: "Accord", year: 2022,
        price: 14750000, status: "Available",
        transmission: "Automatic", fuelType: "Petrol",
        mileage: 31200,
        image: "https://images.unsplash.com/photo-1606664515524-ed2f786a0bd6?auto=format&fit=crop&w=600&q=80"
    },
    {
        id: "4", _id: "4",
        sellerId:    "BestDeals_PH",
        sellerAlias: "Best Deals Port Harcourt",
        make: "Mercedes-Benz", model: "C300", year: 2023,
        price: 42000000, status: "Available",
        transmission: "Automatic", fuelType: "Petrol",
        mileage: 8900,
        image: "https://images.unsplash.com/photo-1618843479313-40f8afb4b4d8?auto=format&fit=crop&w=600&q=80"
    }
];

const newId = () => Date.now().toString();

/* ══════════════════════════════════════════════════════════════
   GET /api/vehicles
   ─ With ?sellerId=xxx  → seller dashboard (own vehicles only)
   ─ With ?admin=true    → admin dashboard (ALL vehicles, any status)
   ─ Without either      → buyer/public view (Available only)

   NOTE: sellerId (Firebase UID) IS included in the public response.
   It is not a secret — it's required so buyers can open a chat
   thread with the seller via chat.html?sellerId=<uid>. Firestore
   security rules (not this mock server) are the real boundary for
   anything sensitive; the UID alone grants no write access.

   The ?admin=true override has NO real authentication in this demo
   server — in production this would be gated behind a verified
   admin session/token, not a client-supplied query flag.
   ══════════════════════════════════════════════════════════════ */
app.get('/api/vehicles', (req, res) => {
    const { sellerId, admin } = req.query;

    if (sellerId) {
        // Seller sees only their own listings
        return res.json(vehicles.filter(v => v.sellerId === sellerId));
    }

    if (admin === 'true') {
        // Admin sees every listing regardless of status, for moderation
        return res.json(vehicles);
    }

    // Buyer sees all Available listings — full data, including sellerId,
    // so "Contact Seller" can open a real chat thread
    const publicListings = vehicles.filter(v => v.status === 'Available');

    res.json(publicListings);
});

/* ══════════════════════════════════════════════════════════════
   POST /api/vehicles  — seller adds a listing
   ══════════════════════════════════════════════════════════════ */
app.post('/api/vehicles', (req, res) => {
    const {
        sellerId, sellerAlias,
        make, model, year, price,
        mileage, transmission, fuelType, status, image
    } = req.body;

    if (!make || !model)  return res.status(400).json({ error: 'make and model are required.' });
    if (!sellerId)        return res.status(400).json({ error: 'sellerId is required.' });

    const id = newId();
    const vehicle = {
        id, _id: id,
        sellerId,
        sellerAlias: sellerAlias || 'Verified Dealer',
        make, model,
        year:         Number(year)   || new Date().getFullYear(),
        price:        Number(price)  || 0,
        mileage:      Number(mileage)|| 0,
        transmission: transmission   || 'Automatic',
        fuelType:     fuelType       || 'Petrol',
        status:       status         || 'Available',
        image:        image          || '',
        createdAt:    new Date().toISOString()
    };

    vehicles.push(vehicle);
    console.log(`[POST] Vehicle added — ID: ${id}, Seller: ${sellerId}`);
    res.status(201).json({ message: 'Vehicle listed successfully!', vehicle });
});

/* ══════════════════════════════════════════════════════════════
   PUT /api/vehicles/:id  — seller updates own listing
   ══════════════════════════════════════════════════════════════ */
app.put('/api/vehicles/:id', (req, res) => {
    const vehicleId = req.params.id;
    const {
        sellerId, sellerAlias, admin,
        make, model, year, price,
        mileage, transmission, fuelType, status, image
    } = req.body;

    const car = vehicles.find(v => v.id === vehicleId || v._id === vehicleId);
    if (!car) return res.status(404).json({ error: 'Vehicle not found.' });

    // Admin can moderate (approve/reject/edit) any listing — bypasses ownership check.
    // Sellers can only edit their own.
    if (admin !== true && sellerId && car.sellerId !== sellerId) {
        return res.status(403).json({ error: 'Permission denied — you do not own this listing.' });
    }

    if (make)             car.make         = make;
    if (model)            car.model        = model;
    if (year)             car.year         = Number(year);
    if (price)            car.price        = Number(price);
    if (mileage)          car.mileage      = Number(mileage);
    if (transmission)     car.transmission = transmission;
    if (fuelType)         car.fuelType     = fuelType;
    if (status)           car.status       = status;
    if (sellerAlias)      car.sellerAlias  = sellerAlias;
    if (image !== undefined) car.image     = image;
    car.updatedAt = new Date().toISOString();

    console.log(`[PUT] Vehicle updated — ID: ${vehicleId}`);
    res.status(200).json({ message: 'Vehicle updated successfully!', vehicle: car });
});

/* ══════════════════════════════════════════════════════════════
   DELETE /api/vehicles/:id?sellerId=<uid>  — seller removes listing
   ══════════════════════════════════════════════════════════════ */
app.delete('/api/vehicles/:id', (req, res) => {
    const vehicleId = req.params.id;
    const { sellerId, admin } = req.query;

    const index = vehicles.findIndex(v => v.id === vehicleId || v._id === vehicleId);
    if (index === -1) return res.status(404).json({ error: 'Vehicle not found.' });

    if (admin !== 'true' && sellerId && vehicles[index].sellerId !== sellerId) {
        return res.status(403).json({ error: 'Permission denied — you do not own this listing.' });
    }

    vehicles.splice(index, 1);
    console.log(`[DELETE] Vehicle removed — ID: ${vehicleId}`);
    res.status(200).json({ message: 'Vehicle removed from listings.' });
});

/* ══════════════════════════════════════════════════════════════
   START
   ══════════════════════════════════════════════════════════════ */
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
    console.log(`Jerry Autos backend → http://localhost:${PORT}`);
});