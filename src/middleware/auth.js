import jwt from 'jsonwebtoken';

export function requireAdmin(req, res, next) {
	const auth = req.headers.authorization || '';
	const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
	if (!token) return res.status(401).json({ error: 'Unauthorized' });
	try {
		const payload = jwt.verify(token, process.env.JWT_SECRET || 'secret');
		req.admin = payload;
		return next();
	} catch (e) {
		return res.status(401).json({ error: 'Unauthorized' });
	}
}


