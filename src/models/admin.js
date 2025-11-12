import { DataTypes } from 'sequelize';
import { sequelize } from './index.js';
import bcrypt from 'bcrypt';

export const Admin = sequelize.define('admins', {
	id: {
		type: DataTypes.INTEGER.UNSIGNED,
		primaryKey: true,
		autoIncrement: true
	},
	username: {
		type: DataTypes.STRING,
		allowNull: false,
		unique: true
	},
	passwordHash: {
		type: DataTypes.STRING,
		allowNull: false
	}
}, {
	indexes: [
		{ fields: ['username'], unique: true }
	]
});

export async function ensureDefaultAdmin() {
	const username = process.env.ADMIN_USERNAME || 'admin';
	const password = process.env.ADMIN_PASSWORD || 'admin';
	const existing = await Admin.findOne({ where: { username } });
	if (!existing) {
		const passwordHash = await bcrypt.hash(password, 10);
		await Admin.create({ username, passwordHash });
		console.log(`Default admin created: ${username}`);
	} else {
		console.log('Default admin exists');
	}
}

export async function validateAdminCredentials(username, password) {
	const admin = await Admin.findOne({ where: { username } });
	if (!admin) return null;
	const ok = await bcrypt.compare(password, admin.passwordHash);
	return ok ? admin : null;
}


