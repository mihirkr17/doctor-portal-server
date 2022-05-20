const express = require('express');
const request = require('request');
const cors = require('cors');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
// var nodemailer = require('nodemailer');
// var sgTransport = require('nodemailer-sendgrid-transport');
const bodyParser = require('body-parser');
// const fetch = require('node-fetch');

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Bodyparser Middleware
app.use(bodyParser.urlencoded({ extended: false }));

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PWD}@cluster0.tfysy.mongodb.net/myFirstDatabase?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

function verifyJWT(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).send({ message: 'UnAuthorized access' });
  }
  const token = authHeader.split(' ')[1];
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, function (err, decoded) {
    if (err) {
      return res.status(403).send({ message: 'Forbidden access' })
    }
    req.decoded = decoded;
    next();
  });
}


// const emailClient = nodemailer.createTransport(emailSenderOptions);

function sendAppointmentEmail(booking) {
  const { patient, patientName, treatment, date, slot } = booking;

  // const data = {
  //   members: [
  //     {
  //       email_address: patient,
  //       status: 'subscribed',
  //       merge_fields: {
  //         FNAME: patientName,
  //         SUBJECT: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
  //         TEXT: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
  //         HTML: `
  //         <div>
  //           <p> Hello ${patientName}, </p>
  //           <h3>Your Appointment for ${treatment} is confirmed</h3>
  //           <p>Looking forward to seeing you on ${date} at ${slot}.</p>

  //           <h3>Our Address</h3>
  //           <p>Lalmonirhat, Rangpur</p>
  //           <p>Bangladesh</p>
  //           <a href="https://web.programming-hero.com/">unsubscribe</a>
  //         </div>
  //       `
  //       }
  //     }
  //   ]
  // };

  const data = {
    members: [
      {
        email_address: patient,
        status: 'subscribed',
        merge_fields: {
          DNAME: patientName,
          SUBJECT: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
          TEXT: `Your Appointment for ${treatment} is on ${date} at ${slot} is Confirmed`,
          HTML: `
             Hello ${patientName},
            Your Appointment for ${treatment} is confirmed
            Looking forward to seeing you on ${date} at ${slot}.
        `
        }
      }
    ]
  };

  const postData = JSON.stringify(data);

  const options = {
    url: 'https://us14.api.mailchimp.com/3.0/lists/0c0c99a9ec',
    method: 'POST',
    headers: {
      Authorization: `auth ${process.env.EMAIL_SENDER_KEY}`
    },
    body: postData
  }

  request(options, (err, res, body) => {
    if (err) {
      console.log("Mail not sent");
    } else {
      if (res.statusCode === 200) {
        console.log("Email send");
      } else {
        console.log("Mail not sent");
      }
    }
  });
}


async function run() {
  try {
    await client.connect();
    const serviceCollection = client.db('doctor_portal').collection('services');
    const bookingCollection = client.db('doctor_portal').collection('bookings');
    const userCollection = client.db('doctor_portal').collection('users');
    const doctorCollection = client.db('doctor_portal').collection('doctors');

    const verifyAdmin = async (req, res, next) => {
      const requester = req.decoded.email;
      const requesterAccount = await userCollection.findOne({ email: requester });
      if (requesterAccount.role === 'admin') {
        next();
      }
      else {
        res.status(403).send({ message: 'forbidden' });
      }
    }

    app.get('/service', async (req, res) => {
      const query = {};
      const cursor = serviceCollection.find(query).project({ name: 1 });
      const services = await cursor.toArray();
      res.send(services);
    });

    app.get('/user', verifyJWT, async (req, res) => {
      const users = await userCollection.find().toArray();
      res.send(users);
    });

    app.get('/admin/:email', async (req, res) => {
      const email = req.params.email;
      const user = await userCollection.findOne({ email: email });
      const isAdmin = user.role === 'admin';
      res.send({ admin: isAdmin })
    })

    app.put('/user/admin/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const updateDoc = {
        $set: { role: 'admin' },
      };
      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    })

    app.put('/user/:email', async (req, res) => {
      const email = req.params.email;
      const user = req.body;
      const filter = { email: email };
      const options = { upsert: true };
      const updateDoc = {
        $set: user,
      };
      const result = await userCollection.updateOne(filter, updateDoc, options);
      const token = jwt.sign({ email: email }, process.env.ACCESS_TOKEN_SECRET, { expiresIn: '1h' })
      res.send({ result, token });
    });

    // Warning: This is not the proper way to query multiple collection. 
    // After learning more about mongodb. use aggregate, lookup, pipeline, match, group
    app.get('/available', async (req, res) => {
      const date = req.query.date;

      // step 1:  get all services
      const services = await serviceCollection.find().toArray();

      // step 2: get the booking of that day. output: [{}, {}, {}, {}, {}, {}]
      const query = { date: date };
      const bookings = await bookingCollection.find(query).toArray();

      // step 3: for each service
      services.forEach(service => {
        // step 4: find bookings for that service. output: [{}, {}, {}, {}]
        const serviceBookings = bookings.filter(book => book.treatment === service.name);
        // step 5: select slots for the service Bookings: ['', '', '', '']
        const bookedSlots = serviceBookings.map(book => book.slot);
        // step 6: select those slots that are not in bookedSlots
        const available = service.slots.filter(slot => !bookedSlots.includes(slot));
        //step 7: set available to slots to make it easier 
        service.slots = available;
      });


      res.send(services);
    })

    app.get('/booking', verifyJWT, async (req, res) => {
      const patient = req.query.patient;
      const decodedEmail = req.decoded.email;
      if (patient === decodedEmail) {
        const query = { patient: patient };
        const bookings = await bookingCollection.find(query).toArray();
        return res.send(bookings);
      }
      else {
        return res.status(403).send({ message: 'forbidden access' });
      }
    });

    app.get('/booking/:id', verifyJWT, async (req, res) => {
      const id = req.params.id;
      const query = { _id: ObjectId(id) };
      const booking = await bookingCollection.findOne(query);
      res.send(booking);
    });

    app.post('/booking', async (req, res) => {
      const booking = req.body;
      const query = { treatment: booking.treatment, date: booking.date, patient: booking.patient }
      const exists = await bookingCollection.findOne(query);
      if (exists) {
        return res.send({ success: false, booking: exists })
      }
      const result = await bookingCollection.insertOne(booking);
      console.log('sending email');
      sendAppointmentEmail(booking);
      return res.send({ success: true, result });
    });

    app.get('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doctors = await doctorCollection.find().toArray();
      res.send(doctors);
    })

    app.post('/doctor', verifyJWT, verifyAdmin, async (req, res) => {
      const doctor = req.body;
      const result = await doctorCollection.insertOne(doctor);
      res.send(result);
    });

    app.delete('/doctor/:email', verifyJWT, verifyAdmin, async (req, res) => {
      const email = req.params.email;
      const filter = { email: email };
      const result = await doctorCollection.deleteOne(filter);
      res.send(result);
    })

  }
  finally {

  }
}

run().catch(console.dir);


app.get('/', (req, res) => {
  res.send('Hello From Doctor Uncle portal!')
})

app.listen(port, () => {
  console.log(`Doctors App listening on port ${port}`)
})