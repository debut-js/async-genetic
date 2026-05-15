import { test, describe } from 'vitest';
import assert from 'node:assert';
import { Genetic, GeneticOptions, Select, Phenotype } from '../../src/genetic';

/** Simple T=number harness: entity is a number, fitness is the entity itself. */
function numericGA(overrides: Partial<GeneticOptions<number>> = {}) {
    let counter = 0;
    return new Genetic<number>({
        populationSize: 10,
        randomFunction: async () => counter++,
        fitnessFunction: async (entity) => ({ fitness: entity }),
        mutationFunction: async (e) => e + 1000,
        crossoverFunction: async (a, b) => [a + b, a * 0 + b * 0],
        ...overrides,
    });
}

describe('Genetic: seed + estimate', () => {
    test('seed fills population to populationSize', async () => {
        const ga = numericGA();
        await ga.seed();
        assert.equal(ga.population.length, 10);
        for (const ph of ga.population) {
            assert.equal(typeof ph.entity, 'number');
            assert.equal(ph.fitness, null);
        }
    });

    test('seed accepts initial entities and tops up the rest', async () => {
        const ga = numericGA({ populationSize: 5 });
        await ga.seed([100, 200]);
        assert.equal(ga.population.length, 5);
        assert.equal(ga.population[0].entity, 100);
        assert.equal(ga.population[1].entity, 200);
    });

    test('estimate sorts population best-first (max by default)', async () => {
        const ga = numericGA();
        await ga.seed([5, 1, 9, 3, 7, 2, 8, 4, 6, 0]);
        await ga.estimate();
        for (let i = 0; i < ga.population.length - 1; i++) {
            assert.ok(
                ga.population[i].fitness >= ga.population[i + 1].fitness,
                `not sorted: ${ga.population[i].fitness} < ${ga.population[i + 1].fitness}`,
            );
        }
        assert.equal(ga.population[0].entity, 9);
    });

    test('optimize callback enables minimization', async () => {
        const ga = numericGA({
            populationSize: 5,
            optimize: (a: Phenotype<number>, b: Phenotype<number>) => a.fitness <= b.fitness,
        });
        await ga.seed([5, 1, 9, 3, 7]);
        await ga.estimate();
        assert.equal(ga.population[0].entity, 1);
        assert.equal(ga.population[ga.population.length - 1].entity, 9);
    });

    test('stats are populated after estimate', async () => {
        const ga = numericGA();
        await ga.seed([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        await ga.estimate();
        const s: any = ga.stats;
        assert.equal(s.fitnessPopulation, 10);
        assert.equal(s.maximumFitness, 10);
        assert.equal(s.minimumFitness, 1);
        assert.equal(s.averageFitness, 5.5);
        assert.ok(s.fitnessStdDev > 0);
    });

    test('estimate throws a descriptive error when fitnessFunction returns NaN', async () => {
        const ga = new Genetic<number>({
            populationSize: 3,
            randomFunction: async () => 1,
            fitnessFunction: async () => ({ fitness: NaN }),
            mutationFunction: async (e) => e,
            crossoverFunction: async (a, b) => [a, b],
        });
        await ga.seed();
        await assert.rejects(() => ga.estimate(), /non-finite fitness/);
    });

    test('estimate throws a descriptive error when fitnessFunction returns undefined fitness', async () => {
        const ga = new Genetic<number>({
            populationSize: 3,
            randomFunction: async () => 1,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            fitnessFunction: async () => ({} as any),
            mutationFunction: async (e) => e,
            crossoverFunction: async (a, b) => [a, b],
        });
        await ga.seed();
        await assert.rejects(() => ga.estimate(), /non-finite fitness/);
    });
});

describe('Genetic: breed', () => {
    test('breed keeps population at populationSize', async () => {
        const ga = numericGA();
        await ga.seed();
        await ga.estimate();
        await ga.breed();
        assert.equal(ga.population.length, 10);
    });

    test('elitism preserves best entity in next generation', async () => {
        const ga = numericGA({
            fittestNSurvives: 1,
            populationSize: 5,
            mutationFunction: async () => -9999, // mutate to garbage
            crossoverFunction: async () => [-9999, -9999],
            mutateProbablity: 1,
            crossoverProbablity: 1,
        });
        await ga.seed([10, 20, 30, 40, 50]);
        await ga.estimate();
        const bestEntity = ga.population[0].entity;
        await ga.breed();
        await ga.estimate();
        // best entity must still be present
        const entities = ga.population.map((p) => p.entity);
        assert.ok(entities.includes(bestEntity), `elite ${bestEntity} missing in ${entities}`);
    });

    test('elite genome carries forward but fitness is re-evaluated each gen (v2)', async () => {
        let calls = 0;
        const ga = new Genetic<number>({
            populationSize: 10,
            fittestNSurvives: 3,
            randomFunction: async () => Math.random(),
            fitnessFunction: async (e) => {
                calls++;
                return { fitness: e };
            },
            mutationFunction: async (e) => e + 0.01,
            crossoverFunction: async (a, b) => [(a + b) / 2, (a + b) / 2],
            mutateProbablity: 1,
            crossoverProbablity: 1,
        });
        await ga.seed();
        await ga.estimate();
        assert.equal(calls, 10, 'first estimate scores every phenotype');
        await ga.breed();
        await ga.estimate();
        // No caching: elite is rescored against the current dataset every gen.
        assert.equal(calls, 20, `expected 20 total calls (10 + 10 fresh), got ${calls}`);
    });

    test('elite entity (genome) carries forward across generations', async () => {
        // Even though fitness is reset on the elite, the genome should
        // re-appear in the next generation's population.
        const ga = new Genetic<number>({
            populationSize: 5,
            fittestNSurvives: 1,
            randomFunction: async () => Math.random(),
            fitnessFunction: async (e) => ({ fitness: e }),
            mutationFunction: async () => -1,
            crossoverFunction: async () => [-1, -1],
            mutateProbablity: 1,
            crossoverProbablity: 1,
        });
        await ga.seed([0.1, 0.2, 0.3, 0.4, 0.9]);
        await ga.estimate();
        const eliteEntity = ga.population[0].entity;
        await ga.breed();
        await ga.estimate();
        const entities = ga.population.map((p) => p.entity);
        assert.ok(entities.includes(eliteEntity), `elite genome ${eliteEntity} missing in ${entities}`);
    });

    test('deduplicate filter rejects invalid entities', async () => {
        let i = 0;
        const ga = new Genetic<number>({
            populationSize: 5,
            randomFunction: async () => i++,
            fitnessFunction: async (e) => ({ fitness: e }),
            mutationFunction: async (e) => e,
            crossoverFunction: async (a, b) => [a, b],
            // only even numbers are considered valid
            deduplicate: (e) => e % 2 === 0,
        });
        await ga.seed();
        for (const ph of ga.population) {
            assert.equal(ph.entity % 2, 0);
        }
    });
});

describe('Genetic: selectPair structural diversity', () => {
    test('avoids breeding structurally identical object parents when alternatives exist', async () => {
        // Population: two slots holding {v:7} (different refs, same shape),
        // one slot holding {v:1}. select2 cycles deterministically through
        // indexes 0, 1, 2, 0, 1, 2... so:
        //   - first pick → index 0 → {v:7}
        //   - second pick → index 1 → {v:7}  (structurally same; must retry)
        //   - third pick → index 2 → {v:1}  (different — accept)
        // Old code with `===` would have accepted the second pick because
        // the references differ, breeding two clones of the same genome.
        type Obj = { v: number };
        const fixedPop: Obj[] = [{ v: 7 }, { v: 7 }, { v: 1 }];
        let cursor = 0;

        const observed: Obj[][] = [];
        const ga = new Genetic<Obj>({
            populationSize: 3,
            randomFunction: async () => fixedPop[cursor++ % fixedPop.length],
            fitnessFunction: async (e) => ({ fitness: e.v }),
            // Deterministic cycling selector
            select2: (pop) => {
                const e = pop[cursor % pop.length].entity;
                cursor++;
                return e;
            },
            select1: (pop) => pop[0].entity,
            crossoverFunction: async (a, b) => {
                observed.push([a, b]);
                return [a, b];
            },
            mutationFunction: async (e) => e,
            mutateProbablity: 0,
            crossoverProbablity: 1,
            fittestNSurvives: 0,
        });
        // bootstrap with our fixed population so we know which entities are present
        cursor = 0;
        await ga.seed();
        // After seed, population has the three fixedPop refs (in some order
        // after estimate sorts them). Re-assert by sorting fitness desc:
        await ga.estimate();
        // sort desc by v: [7, 7, 1]
        cursor = 0; // reset selector cursor for breed
        await ga.breed();

        // None of the recorded crossover pairs may be structurally identical.
        for (const [a, b] of observed) {
            assert.notDeepEqual(a, b, `selectPair returned structurally identical parents: ${JSON.stringify(a)}`);
        }
    });

    test('primitive duplicates still trigger retry (regression for === branch)', async () => {
        const pop = [5, 5, 5, 1];
        let cursor = 0;
        const observed: number[][] = [];
        const ga = new Genetic<number>({
            populationSize: 4,
            randomFunction: async () => pop[cursor++ % pop.length],
            fitnessFunction: async (e) => ({ fitness: e }),
            select2: (p) => p[cursor++ % p.length].entity,
            select1: (p) => p[0].entity,
            crossoverFunction: async (a, b) => {
                observed.push([a, b]);
                return [a, b];
            },
            mutationFunction: async (e) => e,
            mutateProbablity: 0,
            crossoverProbablity: 1,
            fittestNSurvives: 0,
        });
        cursor = 0;
        await ga.seed();
        await ga.estimate();
        cursor = 0;
        await ga.breed();
        // At least one pair should have been forced apart (5 vs 1) instead of
        // breeding (5, 5). We allow some (5, 5) tolerance only after 10 retries
        // exhausted — but with our deterministic cursor we get (5,5)→(5,1).
        const hasDifferentPair = observed.some(([a, b]) => a !== b);
        assert.ok(hasDifferentPair, `expected at least one diverse pair, got ${JSON.stringify(observed)}`);
    });
});

describe('Genetic: crossover/mutation isolation', () => {
    test('crossover does not mutate parent arrays (deep clone)', async () => {
        // entity is an array; mutationFunction modifies it in place
        type Arr = number[];
        const ga = new Genetic<Arr>({
            populationSize: 4,
            randomFunction: async () => [1, 2, 3],
            fitnessFunction: async (e) => ({ fitness: e.reduce((a, b) => a + b, 0) }),
            crossoverFunction: async (a, b) => {
                // mutate the clones the engine passed in
                a[0] = 999;
                b[0] = 888;
                return [a, b];
            },
            mutationFunction: async (e) => {
                e[0] = -1;
                return e;
            },
            mutateProbablity: 1,
            crossoverProbablity: 1,
            fittestNSurvives: 0,
        });
        await ga.seed();
        await ga.estimate();
        const parentRefs = ga.population.map((p) => p.entity);
        const parentSnapshots = parentRefs.map((arr) => [...arr]);
        await ga.breed();
        for (let i = 0; i < parentRefs.length; i++) {
            assert.deepEqual(
                parentRefs[i],
                parentSnapshots[i],
                `parent ${i} mutated by crossover/mutation: ${parentRefs[i]} vs ${parentSnapshots[i]}`,
            );
        }
    });

    test('crossover does not mutate parent objects with nested data', async () => {
        type Obj = { vals: number[] };
        // Keep a reference to every entity randomFunction creates so we can
        // assert later that none of these original instances were touched.
        const created: Obj[] = [];
        const ga = new Genetic<Obj>({
            populationSize: 4,
            randomFunction: async () => {
                const obj: Obj = { vals: [1, 2, 3] };
                created.push(obj);
                return obj;
            },
            fitnessFunction: async (e) => ({ fitness: e.vals.reduce((a, b) => a + b, 0) }),
            crossoverFunction: async (a, b) => {
                a.vals[0] = 999;
                b.vals.push(777);
                return [a, b];
            },
            mutationFunction: async (e) => e,
            mutateProbablity: 0,
            crossoverProbablity: 1,
            fittestNSurvives: 0,
        });
        await ga.seed();
        await ga.estimate();
        await ga.breed();
        // None of the originally created parents should have been mutated by
        // crossover; they must still match the freshly-constructed shape.
        for (const obj of created) {
            assert.deepEqual(obj.vals, [1, 2, 3], `parent object's nested array was mutated: ${JSON.stringify(obj)}`);
        }
    });
});

describe('Genetic: selectors', () => {
    test('Fittest returns the top-1 entity', async () => {
        const ga = numericGA({ select1: Select.Fittest });
        await ga.seed([1, 5, 3, 9, 2]);
        await ga.estimate();
        const fn = Select.Fittest as any;
        assert.equal(fn.call(ga, ga.population), 9);
    });

    test('Tournament2 always returns one of the two sampled', async () => {
        const ga = numericGA();
        await ga.seed([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        await ga.estimate();
        const fn = Select.Tournament2 as any;
        const seen = new Set<number>();
        for (let i = 0; i < 200; i++) {
            seen.add(fn.call(ga, ga.population));
        }
        // with random sampling we should hit several distinct entities
        assert.ok(seen.size >= 3, `tournament too narrow: ${[...seen]}`);
    });

    test('TrueLinearRank picks best more often than worst', async () => {
        const ga = numericGA();
        await ga.seed([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        await ga.estimate();
        const fn = Select.TrueLinearRank as any;
        const counts: Record<number, number> = {};
        for (let i = 0; i < 5000; i++) {
            const e = fn.call(ga, ga.population);
            counts[e] = (counts[e] || 0) + 1;
        }
        assert.ok(
            (counts[10] || 0) > (counts[1] || 0) * 2,
            `linear rank not biased to best: ${JSON.stringify(counts)}`,
        );
    });

    test('RandomLinearRank is not degenerate on first calls', async () => {
        const ga = numericGA();
        await ga.seed([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
        await ga.estimate();
        const fn = Select.RandomLinearRank as any;
        const picks = new Set<number>();
        // reset internal state per generation contract (genetic does this in estimate)
        // here we just call it many times and expect variety
        for (let i = 0; i < 100; i++) {
            picks.add(fn.call(ga, ga.population));
        }
        assert.ok(picks.size >= 3, `RandomLinearRank stuck on ${[...picks]}`);
    });

    test('Sequential cycles through the population', async () => {
        const ga = numericGA({ populationSize: 5 });
        await ga.seed([1, 2, 3, 4, 5]);
        await ga.estimate();
        const fn = Select.Sequential as any;
        const picks: number[] = [];
        for (let i = 0; i < 7; i++) picks.push(fn.call(ga, ga.population));
        // after sort: [5,4,3,2,1] — sequential should hit each at least once over 5 calls
        assert.equal(new Set(picks.slice(0, 5)).size, 5);
    });
});

describe('Genetic: end-to-end convergence (smoke)', () => {
    test('converges toward target value', async () => {
        const target = 42;
        let i = 0;
        const ga = new Genetic<number>({
            populationSize: 30,
            randomFunction: async () => (i++ % 200) - 100,
            fitnessFunction: async (e) => ({ fitness: -Math.abs(e - target) }),
            mutationFunction: async (e) => e + (Math.random() < 0.5 ? -1 : 1),
            crossoverFunction: async (a, b) => [Math.round((a + b) / 2), a],
            mutateProbablity: 0.6,
            crossoverProbablity: 0.8,
            fittestNSurvives: 2,
            select1: Select.Tournament2,
            select2: Select.Tournament2,
        });
        await ga.seed();
        let best = -Infinity;
        for (let gen = 0; gen < 200; gen++) {
            await ga.estimate();
            best = Math.max(best, ga.population[0].fitness);
            if (best === 0) break;
            await ga.breed();
        }
        assert.ok(best > -3, `did not converge: best=${best}`);
    });
});
