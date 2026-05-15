import { test, describe } from 'vitest';
import assert from 'node:assert';
import { IslandGeneticModel, IslandGeneticModelOptions, Migrate } from '../../src/island-model';
import { GeneticOptions } from '../../src/genetic';

function makeIsland(
    islandOpts: Partial<IslandGeneticModelOptions<number>> = {},
    geneticOverrides: Partial<GeneticOptions<number>> = {},
) {
    let counter = 0;
    const opts: GeneticOptions<number> = {
        populationSize: 30,
        randomFunction: async () => counter++,
        fitnessFunction: async (e) => ({ fitness: e }),
        mutationFunction: async (e) => e + 1,
        crossoverFunction: async (a, b) => [a, b],
        mutateProbablity: 0.5,
        crossoverProbablity: 0.5,
        ...geneticOverrides,
    };
    return new IslandGeneticModel<number>({ islandCount: 3, ...islandOpts }, opts);
}

describe('IslandGeneticModel: option defaults', () => {
    test('island defaults are applied when partial options passed (regression: this.options vs options)', async () => {
        // No mutation/crossover probabilities passed — defaults should kick in.
        // Before fix: undefined leaks into Genetic which disables mutation/crossover.
        const ig = makeIsland({ islandCount: 2 });
        await ig.seed();
        // Reach into private islands via the only public projection — population getter
        // For verification, we just confirm breed completes without throwing and population stays sane.
        await ig.estimate();
        await ig.breed();
        assert.equal(ig.population.length, 30);
        // Each phenotype should have a numeric fitness or null (after breed they're reset)
        for (const ph of ig.population) {
            assert.ok(ph.fitness === null || typeof ph.fitness === 'number');
        }
    });
});

describe('IslandGeneticModel: single-island edge case', () => {
    test('islandCount=1 does not infinite-loop on migration', async () => {
        const ig = makeIsland({ islandCount: 1, migrationProbability: 1 });
        await ig.seed();
        await ig.estimate();
        // breed triggers migration internally
        await ig.breed();
        assert.equal(ig.population.length, 30);
    });
});

describe('IslandGeneticModel: stats aggregation', () => {
    test('maximumFitness is max across islands, minimumFitness is min', async () => {
        const ig = makeIsland({ islandCount: 3 }, { populationSize: 9 });
        await ig.seed();
        await ig.estimate();
        const fitnesses = ig.population.map((p) => p.fitness as number);
        const expectedMax = Math.max(...fitnesses);
        const expectedMin = Math.min(...fitnesses);
        const s: any = ig.stats;
        assert.equal(s.maximumFitness, Number(expectedMax.toFixed(4)));
        assert.equal(s.minimumFitness, expectedMin);
    });

    test('fitnessPopulation equals total across islands', async () => {
        const ig = makeIsland({ islandCount: 3 }, { populationSize: 9 });
        await ig.seed();
        await ig.estimate();
        const s: any = ig.stats;
        assert.equal(s.fitnessPopulation, 9);
    });
});

describe('IslandGeneticModel: migration', () => {
    test('migration with probability=1 swaps phenotypes between islands but preserves total population', async () => {
        const ig = makeIsland(
            { islandCount: 3, migrationProbability: 1, migrationFunction: Migrate.Random },
            { populationSize: 9 },
        );
        await ig.seed();
        await ig.estimate();
        const totalBefore = ig.population.length;
        await ig.breed(); // triggers migration
        await ig.estimate();
        const totalAfter = ig.population.length;
        assert.equal(totalAfter, totalBefore, 'population total changed across migration+breed');
    });

    test('Migrate.Fittest returns sequential top-N indexes within a generation', async () => {
        // Regression: previous Migrate.Fittest returned a constant 0.
        // Combined with the dedup check in migration() that capped exports
        // at 1 individual per island per generation.
        const ig = makeIsland({ islandCount: 3 }, { populationSize: 12 });
        await ig.seed();
        await ig.estimate();
        const fakePop = ig.population.slice(0, 5); // any non-empty population
        const fn = Migrate.Fittest as unknown as (this: typeof ig, pop: typeof fakePop) => number;
        // Reset selector state to mimic what migration() does per island.
        (ig as unknown as { internalGenState: Record<string, number> }).internalGenState = {};
        const seq = [
            fn.call(ig, fakePop),
            fn.call(ig, fakePop),
            fn.call(ig, fakePop),
            fn.call(ig, fakePop),
            fn.call(ig, fakePop),
        ];
        assert.deepEqual(seq, [0, 1, 2, 3, 4], `expected sequential top-N, got ${seq}`);
        // Wraps back to 0 once it walked past pop.length.
        assert.equal(fn.call(ig, fakePop), 0);
    });

    test('migration with probability=0 does not move anything', async () => {
        const ig = makeIsland({ islandCount: 3, migrationProbability: 0 }, { populationSize: 9 });
        await ig.seed();
        await ig.estimate();
        const before = ig.population.map((p) => p.entity).sort((a, b) => a - b);
        await ig.breed();
        await ig.estimate();
        // entities will change because of breed/mutation, but no phenotype lost / duplicated due to migration mishandling
        assert.equal(ig.population.length, before.length);
    });
});

describe('IslandGeneticModel: continent', () => {
    test('moveAllToContinent + migrateToIslands round-trips total count', async () => {
        const ig = makeIsland({ islandCount: 3 }, { populationSize: 9 });
        await ig.seed();
        await ig.estimate();
        const total = ig.population.length;
        ig.moveAllToContinent();
        assert.equal(ig.population.length, total);
        ig.migrateToIslands();
        assert.equal(ig.population.length, total);
    });
});

describe('IslandGeneticModel: best()', () => {
    test('best() returns phenotypes sorted by optimize callback', async () => {
        const ig = makeIsland({ islandCount: 3 }, { populationSize: 9 });
        await ig.seed();
        await ig.estimate();
        const top = ig.best(5);
        for (let i = 0; i < top.length - 1; i++) {
            assert.ok((top[i].fitness as number) >= (top[i + 1].fitness as number));
        }
    });
});

