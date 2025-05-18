import mysql, { RowDataPacket } from "mysql2/promise";

const pool = mysql.createPool({
  host: process.env.MYSQL_HOST,
  user: process.env.MYSQL_USER,
  password: process.env.MYSQL_PASSWORD,
  database: process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

export interface VotingEntry {
  voting_round_id: number;
  value: number;
  first_quartile: number;
  third_quartile: number;
  low: number;
  high: number;
  timestamp: number;
  turnout_bips: number;
  submitted_price: number | null;
  decimals?: number;
}

export type PriceHistoryEntry = {
  voting_round_id: number;
  ccxt_price: number;
  onchain_price: number;
  submitted: number;
  ftso_price: number;
  decimals: number;
  first_quartile: number;
  third_quartile: number;
  low: number;
  high: number;
};

export type ExtendedPriceHistoryEntry = {
  voting_round_id: number;
  timestamp: number;
  ccxt_price: number;
  onchain_price: number;
  submitted: number;
  ftso_price: number;
  first_quartile: number;
  third_quartile: number;
  low: number;
  high: number;
  turnout_bips: number;
  decimals: number;
  decimals_onchain: number;
};

export async function getFeedId(feedName: string): Promise<number | undefined> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM ftso_feeds WHERE feed_name = ? LIMIT 1`, [feedName]);
  return rows.length > 0 ? rows[0].id : undefined;
}

export async function getPriceHistory(feedId: number, limit = 30): Promise<ExtendedPriceHistoryEntry[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT 
      ps.voting_round_id,
      vr.timestamp,
      ps.ccxt_price,
      ps.onchain_price,
      ps.submitted_price AS submitted,
      fp.value AS ftso_price,
      fp.first_quartile,
      fp.third_quartile,
      fp.low,
      fp.high,
      fp.turnout_bips,
      ff.decimals,
      ff.decimals_onchain
    FROM price_submissions ps
    JOIN ftso_prices fp ON ps.feed_id = fp.feed_id AND ps.voting_round_id = fp.voting_round_id
    JOIN ftso_feeds ff ON ps.feed_id = ff.id
    JOIN voting_rounds vr ON ps.voting_round_id = vr.id
    WHERE ps.feed_id = ?
    ORDER BY ps.voting_round_id DESC
    LIMIT ?
  `,
    [feedId, limit]
  );

  return rows.map(r => {
    const d = r.decimals;
    const dOnchain = r.decimals_onchain ?? d;

    return {
      voting_round_id: Number(r.voting_round_id),
      timestamp: Number(r.timestamp),
      ccxt_price: Number(r.ccxt_price) / 10 ** d,
      onchain_price: Number(r.onchain_price) / 10 ** dOnchain,
      submitted: Number(r.submitted) / 10 ** d,
      ftso_price: Number(r.ftso_price) / 10 ** d,
      first_quartile: Number(r.first_quartile) / 10 ** d,
      third_quartile: Number(r.third_quartile) / 10 ** d,
      low: Number(r.low) / 10 ** d,
      high: Number(r.high) / 10 ** d,
      turnout_bips: Number(r.turnout_bips),
      decimals: d,
      decimals_onchain: dOnchain,
    };
  });
}

export async function getFeedDecimals(feedName: string): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(`SELECT decimals FROM ftso_feeds WHERE feed_name = ? LIMIT 1`, [
    feedName,
  ]);

  return rows.length > 0 ? rows[0].decimals : null;
}

export async function getFeedOnchainDecimals(feedName: string): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT decimals_onchain FROM ftso_feeds WHERE feed_name = ? LIMIT 1`,
    [feedName]
  );

  return rows.length > 0 ? rows[0].decimals_onchain : null;
}

export async function getVotingHistory(feedName: string, limit = 5): Promise<VotingEntry[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.voting_round_id, p.value, p.first_quartile, p.third_quartile,
          p.low, p.high, r.timestamp, p.turnout_bips, s.submitted_price
   FROM ftso_prices p
   JOIN voting_rounds r ON r.id = p.voting_round_id
   JOIN ftso_feeds f ON f.id = p.feed_id
   LEFT JOIN price_submissions s ON s.feed_id = p.feed_id AND s.voting_round_id = p.voting_round_id
   WHERE f.feed_name = ?
   ORDER BY p.voting_round_id DESC
   LIMIT ?`,
    [feedName, limit]
  );

  return rows.map(row => ({
    voting_round_id: row.voting_round_id,
    value: parseFloat(row.value),
    first_quartile: parseFloat(row.first_quartile),
    third_quartile: parseFloat(row.third_quartile),
    low: parseFloat(row.low),
    high: parseFloat(row.high),
    timestamp: row.timestamp,
    turnout_bips: row.turnout_bips,
    submitted_price: row.submitted_price !== null ? parseFloat(row.submitted_price) : null,
  }));
}

export async function storeSubmittedPrice(
  feedName: string,
  votingRoundId: number,
  submitted: number,
  ccxt: number,
  onchain: number
): Promise<void> {
  try {
    const [rows] = await pool.query<RowDataPacket[]>(`SELECT id FROM ftso_feeds WHERE feed_name = ? LIMIT 1`, [
      feedName,
    ]);

    if (rows.length === 0) {
      console.warn(`⚠️ Kein Feed mit feed_name='${feedName}' gefunden – Preis wird nicht gespeichert.`);
      return;
    }

    const feedId = rows[0].id;

    //console.debug(
    //  `📦 Speichere Preis: VotingRound ${votingRoundId} (BIGINT Dezimal1 ${Decimals} 2: ${OnchainDecimals}): submitted=${submitted}, ccxt=${ccxt}, onchain=${onchain}`
    //);

    await pool.query(`INSERT IGNORE INTO voting_rounds (id) VALUES (?)`, [votingRoundId]);

    await pool.query(
      `INSERT INTO price_submissions (feed_id, voting_round_id, submitted_price, ccxt_price, onchain_price)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         submitted_price = VALUES(submitted_price),
         ccxt_price = VALUES(ccxt_price),
         onchain_price = VALUES(onchain_price)`,
      [feedId, votingRoundId, submitted, ccxt, onchain]
    );
  } catch (err) {
    console.error("❌ Fehler bei storeSubmittedPrice:", err);
  }
}

export async function updateOnchainDecimalsIfNull(feedName: string, onchainDecimals: number): Promise<void> {
  try {
    await pool.query(
      `UPDATE ftso_feeds 
       SET decimals_onchain = ?
       WHERE feed_name = ? AND decimals_onchain IS NULL`,
      [onchainDecimals, feedName]
    );
  } catch (err) {
    console.error(`❌ Fehler beim Setzen von decimals_onchain für '${feedName}':`, err);
  }
}
