import { Sequelize } from 'sequelize';

const {
	DB_HOST,
	DB_USER,
	DB_PASS,
	DB_NAME
} = process.env;

export const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASS, {
	host: DB_HOST || 'localhost',
	dialect: 'mysql',
	logging: false,
	define: {
		freezeTableName: true,
		underscored: false
	}
});


