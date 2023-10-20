if (process.env.NODE_ENV === 'development') require('dotenv').config();
const express = require('express');
const calculateRewards = require('./utils/getRewards');
const cors = require('cors');
const dayjs = require('dayjs');

const app = express();

app.use(
  cors({
    origin: '*',
  })
);

app.use(express.json());

app.post('/api/get-rewards', async (req, res) => {
  try {
    const { address, startDate, endDate } = req.body;

    if (!address || !startDate || !endDate)
      return res
        .status(400)
        .json({
          success: false,
          message: 'address, startDate and endDate are required',
        });

    console.log(startDate, endDate);
    let startDateNew = dayjs(startDate).format('YYYY-MM-DD');
    let endDateNew = dayjs(endDate).format('YYYY-MM-DD');
    console.log(
      'search start for address ',
      address,
      ' from ',
      startDateNew,
      ' to ',
      endDateNew
    );

    if (
      new Date(endDateNew).getTime() ===
      new Date(new Date().toISOString().split('T')[0]).getTime()
    ) {
      const today = new Date();
      today.setDate(today.getDate() - 1);
      endDateNew = today.toISOString().split('T')[0];
    }
    calculateRewards(address, startDateNew, endDateNew);
    res
      .status(200)
      .json({ success: true, message: 'Rewards will avaliable after 30min ' });
  } catch (error) {
    console.error(error);
    return next(new CustomError(error.message, req.body.address));
  }
});

app.use((err, req, res, next) => {
  res.status(500).json({ success: false, message: err.message });
});

const port = process.env.PORT || 3000;

app.listen(port, () => {
  console.log('server started');
});

class CustomError extends Error {
  constructor(message, address) {
    super(message);
    this.address = address;
  }
}
