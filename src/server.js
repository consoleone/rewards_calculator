if (process.env.NODE_ENV === 'development') require('dotenv').config();
const express = require('express');
const calculateRewards = require('./utils/getRewards');
const cors = require('cors');

const app = express();

app.use(
  cors({
    origin: '*',
    preflightContinue: true,
    optionsSuccessStatus: 204,
  })
);

app.use(express.json());

app.post('/api/get-rewards', (req, res) => {
  const { address, startDate, endDate } = req.body;
  calculateRewards(address, startDate, endDate);
  res
    .status(200)
    .json({ success: true, message: 'Rewards will avaliable after 30min ' });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log('server started');
});
