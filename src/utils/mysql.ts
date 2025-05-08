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
}

export async function getVotingHistory(feedName: string, limit = 5): Promise<VotingEntry[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT p.voting_round_id, p.value, p.first_quartile, p.third_quartile,
            p.low, p.high, p.timestamp, p.turnout_bips, s.submitted_price
     FROM ftso_prices p
     JOIN ftso_feeds f ON f.id = p.feed_id
     LEFT JOIN my_price_submissions s ON s.feed_id = p.feed_id AND s.voting_round_id = p.voting_round_id
     WHERE f.representation = ?
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
    submitted_price: row.submitted_price !== null ? parseFloat(row.submitted_price) : null
  }));
}

export async function storeSubmittedPrice(
  feedName: string,
  votingRoundId: number,
  value: number,
  timestamp: number
): Promise<void> {
  const sql = `
    INSERT INTO my_price_submissions (feed_id, voting_round_id, submitted_price, timestamp)
    VALUES ((SELECT id FROM ftso_feeds WHERE representation = ? LIMIT 1), ?, ?, ?)
    ON DUPLICATE KEY UPDATE
      submitted_price = VALUES(submitted_price),
      timestamp = VALUES(timestamp)
  `;

  try {
    const [rows] = await pool.query<RowDataPacket[]>(
      `SELECT id FROM ftso_feeds WHERE representation = ? LIMIT 1`,
      [feedName]
    );

    if (rows.length === 0) {
      console.warn(`⚠️ Kein Feed mit representation='${feedName}' gefunden – Preis wird nicht gespeichert.`);
      return;
    }

    await pool.query(sql, [feedName, votingRoundId, value, timestamp]);
  } catch (err) {
    console.error("❌ Fehler bei storeSubmittedPrice:", err);
  }
}
