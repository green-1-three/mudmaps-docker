/**
 * Job Tracker Service
 * Tracks status of long-running background jobs
 */

class JobTrackerService {
    constructor() {
        this.jobs = new Map();
        this.maxJobs = 100; // Keep last 100 jobs in memory
    }

    /**
     * Create a new job
     * @param {string} type - Job type (e.g., 'reprocess-polylines')
     * @param {Object} params - Job parameters
     * @returns {string} Job ID
     */
    createJob(type, params = {}) {
        const jobId = `${type}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        const job = {
            id: jobId,
            type,
            params,
            status: 'running',
            progress: {
                current: 0,
                total: 0,
                percentage: 0
            },
            result: null,
            error: null,
            createdAt: new Date(),
            startedAt: new Date(),
            completedAt: null
        };

        this.jobs.set(jobId, job);
        this.cleanupOldJobs();

        return jobId;
    }

    /**
     * Update job progress
     * @param {string} jobId - Job ID
     * @param {number} current - Current progress
     * @param {number} total - Total items
     */
    updateProgress(jobId, current, total) {
        const job = this.jobs.get(jobId);
        if (!job) return;

        job.progress = {
            current,
            total,
            percentage: total > 0 ? Math.round((current / total) * 100) : 0
        };
    }

    /**
     * Mark job as completed
     * @param {string} jobId - Job ID
     * @param {Object} result - Job result
     */
    completeJob(jobId, result) {
        const job = this.jobs.get(jobId);
        if (!job) return;

        job.status = 'completed';
        job.result = result;
        job.completedAt = new Date();
    }

    /**
     * Mark job as failed
     * @param {string} jobId - Job ID
     * @param {Error|string} error - Error object or message
     */
    failJob(jobId, error) {
        const job = this.jobs.get(jobId);
        if (!job) return;

        job.status = 'failed';
        job.error = error instanceof Error ? error.message : error;
        job.completedAt = new Date();
    }

    /**
     * Get job status
     * @param {string} jobId - Job ID
     * @returns {Object|null} Job object or null if not found
     */
    getJob(jobId) {
        return this.jobs.get(jobId) || null;
    }

    /**
     * Get all jobs
     * @returns {Array} Array of job objects
     */
    getAllJobs() {
        return Array.from(this.jobs.values())
            .sort((a, b) => b.createdAt - a.createdAt);
    }

    /**
     * Clean up old jobs to prevent memory leaks
     */
    cleanupOldJobs() {
        if (this.jobs.size <= this.maxJobs) return;

        // Sort by creation date and remove oldest
        const jobs = Array.from(this.jobs.values())
            .sort((a, b) => a.createdAt - b.createdAt);

        const toRemove = jobs.slice(0, this.jobs.size - this.maxJobs);
        toRemove.forEach(job => this.jobs.delete(job.id));
    }
}

// Singleton instance
const jobTracker = new JobTrackerService();

module.exports = jobTracker;
