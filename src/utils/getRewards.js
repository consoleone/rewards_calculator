if (process.env.NODE_ENV === 'development') require('dotenv').config();
const api = require('../api');
const { getDb, client } = require('../db/mongo');
const { Parser } = require('json2csv');
const { BlobServiceClient } = require('@azure/storage-blob');
const { v4 } = require('uuid');

const blobServiceClient = BlobServiceClient.fromConnectionString(
  process.env.BLOB_URI
);

const queryDate = async (epoch) => {
  try {
    return api
      .post('/validator', {
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
  } catch (error) {
    console.log('error in queryDate retrying in 1s');
    return new Promise((resolve) => setTimeout(resolve, 1000)).then(() =>
      queryDate(epoch)
    );
  }
};

const fields = [
  'rewardDate',
  'validator',
  'tokenIdentifier',
  'epoch',
  'time',
  'totalStaket',
  'reward',
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
  const result = await api.post('/account/stakes', {
    network_identifier: {
      network: 'mainnet',
    },
    account_identifier: {
      address,
    },
    at_state_identifier: {
      epoch,
    },
  });
  return result.data;
}

async function transactions(address) {
  let nextCursor = '0';

  const stakeTransaction = [];
  do {
    const result = await api.post('/account/transactions', {
      network_identifier: {
        network: 'mainnet',
      },
      account_identifier: {
        address,
      },
      cursor: nextCursor,
    });

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
  const stakeTransactions = await transactions(address).catch((error) =>
    console.error(error, 'error at transaction api')
  );
  const data = [];
  let startStake;
  let endStake;
  const db = await getDb();
  const pricesCollection = db.collection('dailyPrices');

  while (currentEpoch <= end) {
    if (!startStake) {
      startStake = await getStakes(address, currentEpoch).catch((error) =>
        console.error(error, 'error at stakes api')
      );
    } else {
      startStake = endStake;
    }
    endStake = await getStakes(address, ++currentEpoch).catch((error) =>
      console.error(error, 'error at stakes api')
    );
    const rewardDate = new Date(startStake.ledger_state.timestamp)
      .toISOString()
      .split('T')[0];
    const prices = await pricesCollection
      .findOne({ symbol: 'xrd', date: rewardDate })
      .then((value) => {
        if (value) {
          return value.prices;
        }
      });

    if (!prices) {
      continue;
    }

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
          totalStake: stake.delegated_stake.value,
          reward: reward,
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

const getLatestEpoch = async () => {
  try {
    return api
      .post('/validator', {
        network_identifier: {
          network: 'mainnet',
        },
        validator_identifier: {
          address:
            'rv1qvjz86qwa7l80y8vhfuhz6957ch6texdmpk98rg2gtakhr0avan4jplkxy7',
        },
      })
      .then(({ data }) => data.ledger_state.epoch);
  } catch (error) {
    console.log('error in getLatestEpoch retrying in 1s');
    return new Promise((resolve) => setTimeout(resolve, 1000)).then(() =>
      getLatestEpoch()
    );
  }
};

async function getStartEpoch(date) {
  if (new Date(date).getTime() <= new Date('2021-08-11').getTime()) return 3;
  let startEpoch = 1;
  let endEpoch = await getLatestEpoch();

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
  let endEpoch = await getLatestEpoch();

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
  if (data && data.length > 0) {
    csv = parser.parse(data);
  } else {
    csv = parser.parse([
      {
        rewardDate: '',
        validator: '',
        tokenIdentifier: '',
        epoch: '',
        time: '',
        totalStake: '',
        reward: '',
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
  console.log('blob saved for address ' + address);
  console.log('Search ended for address ' + address);
}

module.exports = start;
