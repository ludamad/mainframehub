export function setupAPI(app, services) {
    const { discovery, prService, config } = services;
    // GET /api/discover - List all sessions with PR info
    app.get('/api/discover', async (req, res) => {
        try {
            const states = await discovery.discover();
            res.json({
                sessions: states.map(state => ({
                    sessionId: state.session.id,
                    workingDir: state.session.workingDir,
                    isActive: state.isActive,
                    hasGit: state.hasGit,
                    hasPR: state.hasPR,
                    git: state.gitInfo ? {
                        repo: state.gitInfo.repo,
                        branch: state.gitInfo.branch,
                        remote: state.gitInfo.remote,
                        isDirty: state.gitInfo.isDirty,
                        isAhead: state.gitInfo.isAhead,
                        isBehind: state.gitInfo.isBehind
                    } : null,
                    pr: state.pr ? {
                        number: state.pr.number,
                        title: state.pr.title,
                        url: state.pr.url,
                        state: state.pr.state,
                        draft: state.pr.draft,
                        branch: state.pr.branch,
                        baseBranch: state.pr.baseBranch
                    } : null
                }))
            });
        }
        catch (error) {
            console.error('Error discovering sessions:', error);
            res.status(500).json({
                error: 'Failed to discover sessions',
                message: error.message
            });
        }
    });
    // POST /api/new - Create new PR + session
    app.post('/api/new', async (req, res) => {
        try {
            const { prompt, baseBranch } = req.body;
            if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) {
                return res.status(400).json({
                    error: 'Invalid request',
                    message: 'prompt is required and must be a non-empty string'
                });
            }
            const result = await prService.createNew({
                prompt: prompt.trim(),
                baseBranch: baseBranch || config.baseBranch
            });
            res.json({
                success: true,
                pr: {
                    number: result.pr.number,
                    title: result.pr.title,
                    url: result.pr.url,
                    branch: result.pr.branch,
                    baseBranch: result.pr.baseBranch
                },
                session: {
                    id: result.session.id,
                    workingDir: result.session.workingDir
                },
                clonePath: result.clonePath
            });
        }
        catch (error) {
            console.error('Error creating new PR:', error);
            res.status(500).json({
                error: 'Failed to create new PR',
                message: error.message
            });
        }
    });
    // POST /api/setup/:prNumber - Setup existing PR
    app.post('/api/setup/:prNumber', async (req, res) => {
        try {
            const prNumber = parseInt(req.params.prNumber);
            const { baseBranch } = req.body;
            if (isNaN(prNumber) || prNumber <= 0) {
                return res.status(400).json({
                    error: 'Invalid request',
                    message: 'prNumber must be a positive integer'
                });
            }
            const result = await prService.setupExisting({
                prNumber,
                baseBranch: baseBranch || config.baseBranch
            });
            res.json({
                success: true,
                pr: {
                    number: result.pr.number,
                    title: result.pr.title,
                    url: result.pr.url,
                    branch: result.pr.branch,
                    baseBranch: result.pr.baseBranch
                },
                session: {
                    id: result.session.id,
                    workingDir: result.session.workingDir
                },
                clonePath: result.clonePath
            });
        }
        catch (error) {
            console.error(`Error setting up PR #${req.params.prNumber}:`, error);
            res.status(500).json({
                error: 'Failed to setup PR',
                message: error.message
            });
        }
    });
    // POST /api/close/:prNumber - Close PR + cleanup
    app.post('/api/close/:prNumber', async (req, res) => {
        try {
            const prNumber = parseInt(req.params.prNumber);
            if (isNaN(prNumber) || prNumber <= 0) {
                return res.status(400).json({
                    error: 'Invalid request',
                    message: 'prNumber must be a positive integer'
                });
            }
            await prService.close({ prNumber });
            res.json({
                success: true,
                message: `PR #${prNumber} closed and cleaned up`
            });
        }
        catch (error) {
            console.error(`Error closing PR #${req.params.prNumber}:`, error);
            res.status(500).json({
                error: 'Failed to close PR',
                message: error.message
            });
        }
    });
    // GET /api/config - Get server config
    app.get('/api/config', (req, res) => {
        res.json({
            repo: config.repo,
            repoName: config.repoName,
            baseBranch: config.baseBranch,
            sessionPrefix: config.sessionPrefix,
            guidelines: config.guidelines || {}
        });
    });
}
//# sourceMappingURL=api.js.map