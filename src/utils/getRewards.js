if (process.env.NODE_ENV === 'development') require('dotenv').config();
const axios = require('axios');
const { getDb, client } = require('../db/mongo');
const { Parser } = require('json2csv');
const { BlobServiceClient } = require('@azure/storage-blob');
const { v4 } = require('uuid');

const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.BLOB_URI
);

const queryDate = (epoch) => {
  return axios
    .post('https://gateway.caviarnine.com/validator', {
      network_identifier: {
        network: 'mainnet',
      },
      validator_identifier: {
        address:
          'rv1qvjz86qwa7l80y8vhfuhz6957ch6texdmpk98rg2gtakhr0avan4jplkxy7',
      },
      at_state_identifier: {
        epoch,
      },
    })
    .then(({ data }) => data.ledger_state.timestamp.split('T')[0]);
};

const fields = [
  'rewardDate',
  'validator',
  'tokenIdentifier',
  'epoch',
  'time',
  'amount',
  'usd',
  'gbp',
  'eur',
  'jpy',
  'cny',
  'inr',
  'aud',
  'krw',
];

async function getStakes(address, epoch) {
  const result = await axios.post(
    'https://gateway.caviarnine.com/account/stakes',
    {
      network_identifier: {
        network: 'mainnet',
      },
      account_identifier: {
        address,
      },
      at_state_identifier: {
        epoch,
      },
    }
  );
  return result.data;
}

async function transactions(address) {
  let nextCursor = '0';

  const stakeTransaction = [];
  do {
    const result = await axios.post(
      'https://gateway.caviarnine.com/account/transactions',
      {
        network_identifier: {
          network: 'mainnet',
        },
        account_identifier: {
          address,
        },
        cursor: nextCursor,
      }
    );

    nextCursor = result.data.next_cursor;
    for (const transaction of result.data.transactions) {
      if (transaction.actions[0].type === 'StakeTokens') {
        stakeTransaction.push(transaction);
      }
    }
  } while (nextCursor);
  return stakeTransaction;
}

async function calculateRewards(address, start, end) {
  let rewards = 0;
  let currentEpoch = start;
  const stakeTransactions = await transactions(address);
  const data = [];
  let startStake;
  let endStake;
  const db = await getDb();
  const pricesCollection = db.collection('dailyPrices');

  while (currentEpoch <= end) {
    if (!startStake) {
      startStake = await getStakes(address, currentEpoch);
    } else {
      startStake = endStake;
    }
    endStake = await getStakes(address, ++currentEpoch);
    const rewardDate = new Date(startStake.ledger_state.timestamp)
      .toISOString()
      .split('T')[0];
    const prices = await pricesCollection
      .findOne({ symbol: 'xrd', date: rewardDate })
      .then((value) => value.prices);

    for (const stake of startStake.stakes) {
      let reward = 0;
      for (const stake_end of endStake.stakes) {
        if (
          stake.delegated_stake.token_identifier.rri === 'xrd_rr1qy5wfsfh' &&
          stake_end.delegated_stake.token_identifier.rri ===
            'xrd_rr1qy5wfsfh' &&
          stake_end.validator_identifier.address ===
            stake.validator_identifier.address
        ) {
          reward = (
            (stake_end.delegated_stake.value - stake.delegated_stake.value) /
            1000000000000000000
          ).toFixed(10);
          console.log(reward, startStake.ledger_state.epoch);
        }
      }
      if (reward > 0) {
        for (const stakeTransaction of stakeTransactions) {
          if (
            stakeTransaction.actions[0].to_validator.address ===
            stake.validator_identifier.address
          ) {
            const startDate = new Date(startStake.ledger_state.timestamp);
            const endDate = new Date(endStake.ledger_state.timestamp);
            const transactionDate = new Date(
              stakeTransaction.transaction_status.confirmed_time
            );
            const isInBetween = Boolean(
              transactionDate >= startDate && transactionDate < endDate
            );

            if (isInBetween) {
              reward =
                reward -
                stakeTransaction.actions[0].amount.value / 1000000000000000000;
            }
          }
        }

        data.push({
          rewardDate,
          validator: stake.validator_identifier.address,
          tokenIdentifier: stake.delegated_stake.token_identifier.rri,
          epoch: startStake.ledger_state.epoch,
          time: startStake.ledger_state.timestamp,
          amount: stake.delegated_stake.value,
          usd: (reward * prices.usd).toFixed(10),
          gbp: (reward * prices.gbp).toFixed(10),
          eur: (reward * prices.eur).toFixed(10),
          jpy: (reward * prices.jpy).toFixed(10),
          cny: (reward * prices.cny).toFixed(10),
          inr: (reward * prices.inr).toFixed(10),
          aud: (reward * prices.aud).toFixed(10),
          krw: (reward * prices.krw).toFixed(10),
        });
        rewards = rewards + reward;
      }
    }
  }
  return [rewards, data];
}

async function getStartEpoch(date) {
  if (new Date(date).getTime() <= new Date('2021-08-11').getTime()) return 3;
  let startEpoch = 1;
  let endEpoch = await axios
    .post('https://gateway.caviarnine.com/validator', {
      network_identifier: {
        network: 'mainnet',
      },
      validator_identifier: {
        address:
          'rv1qvjz86qwa7l80y8vhfuhz6957ch6texdmpk98rg2gtakhr0avan4jplkxy7',
      },
    })
    .then(({ data }) => data.ledger_state.epoch);

  while (startEpoch <= endEpoch) {
    const midEpoch = Math.floor((startEpoch + endEpoch) / 2);
    const midDate = await queryDate(midEpoch);

    if (new Date(date).getTime() > new Date(midDate).getTime()) {
      startEpoch = midEpoch + 1;
    } else if (new Date(date).getTime() < new Date(midDate).getTime()) {
      endEpoch = midEpoch - 1;
    } else if (new Date(date).getTime() === new Date(midDate).getTime()) {
      const prevDate = await queryDate(midEpoch - 1);
      if (new Date(prevDate).getTime() === new Date(midDate).getTime()) {
        endEpoch = midEpoch - 1;
      } else {
        return midEpoch;
      }
    }
  }
}

async function getEndEpoch(date) {
  if (new Date(date).getTime() < new Date('2021-08-11').getTime()) return 3;

  let startEpoch = 1;
  let endEpoch = await axios
    .post('https://gateway.caviarnine.com/validator', {
      network_identifier: {
        network: 'mainnet',
      },
      validator_identifier: {
        address:
          'rv1qvjz86qwa7l80y8vhfuhz6957ch6texdmpk98rg2gtakhr0avan4jplkxy7',
      },
    })
    .then(({ data }) => data.ledger_state.epoch);

  if (
    new Date(new Date().toISOString().split('T')[0]).getTime() ===
    new Date(date).getTime()
  )
    return endEpoch;

  while (startEpoch <= endEpoch) {
    const midEpoch = Math.floor((startEpoch + endEpoch) / 2);
    const midDate = await queryDate(midEpoch);

    if (new Date(date).getTime() > new Date(midDate).getTime()) {
      startEpoch = midEpoch + 1;
    } else if (new Date(date).getTime() < new Date(midDate).getTime()) {
      endEpoch = midEpoch - 1;
    } else if (new Date(date).getTime() === new Date(midDate).getTime()) {
      const nextDate = await queryDate(midEpoch + 1);
      if (new Date(nextDate).getTime() === new Date(midDate).getTime()) {
        startEpoch = midEpoch + 1;
      } else {
        return midEpoch;
      }
    }
  }
}

async function start(address, startDate, endDate) {
  const [rewards, data] = await calculateRewards(
    address,
    await getStartEpoch(startDate),
    await getEndEpoch(endDate)
  );

  const parser = new Parser(fields);
  let csv;
  if (data.length > 0) {
    csv = parser.parse(data);
  } else {
    csv = parser.parse([
      {
        rewardDate: '',
        validator: '',
        tokenIdentifier: '',
        epoch: '',
        time: '',
        amount: '',
        usd: '',
        gbp: '',
        eur: '',
        jpy: '',
        cny: '',
        inr: '',
        aud: '',
        krw: '',
      },
    ]);
  }
  const blobName = `${address}_${new Date(startDate).getTime()}_${new Date(
    endDate
  ).getTime()}.csv`;

  const db = await getDb();
  const containerName = await db.collection('containers').findOne({ address });

  if (containerName) {
    const containerClient = blobServiceClient.getContainerClient(
      containerName.containerName
    );
    const blockBlobClient = containerClient.getBlockBlobClient(blobName);
    await blockBlobClient.upload(csv, csv.length);
  } else {
    const newContainerName = v4();

    const { containerClient } = await blobServiceClient.createContainer(
      newContainerName
    );

    await db
      .collection('containers')
      .insertOne({ address, containerName: newContainerName });
    const blockblobClient = containerClient.getBlockBlobClient(blobName);
    await blockblobClient.upload(csv, csv.length);
  }
}

module.exports = start;
