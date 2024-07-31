const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const bcrypt = require("bcryptjs");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const jwt = require("jsonwebtoken");
const port = process.env.PORT || 5000;

// middleware
const corsOptions = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://blood-bond-f0feb.web.app",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOptions));
app.use(express.json());
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = req.headers.authorization;
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.decoded = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.gjqtths.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const usersCollection = client.db("paypulseDB").collection("users");
    const requestsCollection = client.db("paypulseDB").collection("requests");

    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "7d",
      });
      res.send({ token });
    });

    // New User Registration
    app.post("/register", async (req, res) => {
      const formData = req.body;
      const { name, email, number, pin } = formData;
      try {
        const hashedPin = await bcrypt.hash(pin, 10);
        console.log(hashedPin);
        const newUser = {
          name,
          pin: hashedPin,
          number,
          email,
          status: "pending",
          balance: 0,
          role: "user",
        };
        const result = await usersCollection.insertOne(newUser);
        res.send(result);
      } catch (err) {
        res.status(400).send(err.message);
      }
    });

    // <------- Send Money Operation -------->
    app.patch("/send", verifyToken, async (req, res) => {
      const sendData = req.body;
      const {
        recipient_number,
        send_amount,
        pin: senderPin,
        userEmail,
      } = sendData;

      if (send_amount < 50) {
        return res.status(400).send("Amount should be at least 50 Taka");
      }

      try {
        const recipient = await usersCollection.findOne({
          number: recipient_number,
        });

        if (!recipient) {
          return res.status(404).send("Recipient not found");
        }

        if (recipient.role !== "user") {
          return res.send("Not an user");
        }

        const sender = await usersCollection.findOne({
          email: userEmail,
        });

        const isMatch = await bcrypt.compare(senderPin, sender.pin);
        if (!isMatch) return res.status(400).send("Incorrect PIN");

        let senderNewBalance;
        if (send_amount > 99) {
          senderNewBalance = sender.balance - (send_amount + 5);
        } else {
          senderNewBalance = sender.balance - send_amount;
        }

        if (senderNewBalance < 0) {
          return res.status(400).send("Insufficient Balance");
        }

        const senderQuery = { email: userEmail };

        const newBalance = recipient.balance + send_amount;

        const query = { number: recipient_number };

        const updateResult = {
          $set: { balance: newBalance },
        };

        const senderUpdate = {
          $set: { balance: senderNewBalance },
        };

        const result = await usersCollection.updateOne(query, updateResult);
        const sendingResult = await usersCollection.updateOne(
          senderQuery,
          senderUpdate
        );
        res.send(result);
      } catch (error) {
        res.status(500).send("Server error");
      }
    });

    // <--------- Cash Out --------->
    app.patch("/cashout", verifyToken, async (req, res) => {
      // return console.log("hit");
      const sendData = req.body;
      const { agent_number, send_amount, pin: senderPin, userEmail } = sendData;

      if (send_amount < 50) {
        return res.status(400).send("Amount should be at least 50 Taka");
      }

      try {
        const agent = await usersCollection.findOne({
          number: agent_number,
        });

        if (!agent) {
          return res.status(404).send("Agent not found");
        }

        if (agent.role !== "agent") {
          return res.send("Not an agent.");
        }

        const sender = await usersCollection.findOne({
          email: userEmail,
        });

        const isMatch = await bcrypt.compare(senderPin, sender.pin);
        if (!isMatch) return res.status(400).send("Incorrect PIN");

        let senderNewBalance;
        if (send_amount > 99) {
          senderNewBalance = sender.balance - (send_amount + 5);
        } else {
          senderNewBalance = sender.balance - send_amount;
        }

        if (senderNewBalance < 0) {
          return res.status(400).send("Insufficient Balance");
        }

        const senderQuery = { email: userEmail };

        const newBalance = agent.balance + send_amount;

        const query = { number: agent_number };

        const updateResult = {
          $set: { balance: newBalance },
        };

        const senderUpdate = {
          $set: { balance: senderNewBalance },
        };

        const result = await usersCollection.updateOne(query, updateResult);
        const sendingResult = await usersCollection.updateOne(
          senderQuery,
          senderUpdate
        );
        // res.send(sendingResult);
        res.send(result);
      } catch (error) {
        res.status(500).send("Server error");
      }
    });

    // <--------- Cash In requests --------->
    app.post("/requests", async (req, res) => {
      const sendingData = req.body;
      console.log(sendingData);
      const { agent_number, send_amount, pin: senderPin, user } = sendingData;

      try {
        const agent = await usersCollection.findOne({
          number: agent_number,
          role: "agent",
        });

        if (!agent) {
          res.status(404).send("Agent not found");
        }

        const sender = await usersCollection.findOne({
          email: user,
        });

        const isMatch = await bcrypt.compare(senderPin, sender.pin);
        if (!isMatch) return res.status(400).send("Incorrect PIN");

        const request = {
          from: user,
          amount: send_amount,
          status: "pending",
          time: new Date().toISOString(),
        };

        const result = await requestsCollection.insertOne(request);
        res.send(result);
      } catch (error) {
        res.status(500).send("Server error");
      }
    });

    // User login
    app.post("/login", async (req, res) => {
      const formData = req.body;
      const { identifier, pin } = formData;
      try {
        const user = await usersCollection.findOne({
          $or: [{ number: identifier }, { email: identifier }],
        });
        if (!user) return res.status(400).send("Invalid Credentials");

        const isMatch = await bcrypt.compare(pin, user.pin);
        if (!isMatch) return res.status(400).send("Invalid Credentials");

        const token = jwt.sign(
          { email: user.email },
          process.env.ACCESS_TOKEN_SECRET,
          {
            expiresIn: "1h",
          }
        );
        res.json({ token });
      } catch (error) {
        res.status(500).send("Server error");
      }
    });

    app.get("/login", async (req, res) => {
      const result = await usersCollection.find().toArray();
      res.send(result);
    });

    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from PayPulse Server..");
});

app.listen(port, () => {
  console.log(`PayPulse is running on port ${port}`);
});
