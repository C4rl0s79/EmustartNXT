"""Zwięzły zbiór chunków buildu (ChunkSet): ta sama odpowiedź co słownik {md5: rozmiar}, kilka razy mniej pamięci.
Archiwum ma miliony chunków — słowniki wszystkich buildów trzymały w serwerze ~1 GB przez cały czas działania."""
import hashlib
import os
import sys
import tracemalloc
import unittest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from emustart.gogarchive import ChunkSet  # noqa: E402


def _md5(i: int) -> str:
    return hashlib.md5(str(i).encode()).hexdigest()


class ChunkSetTest(unittest.TestCase):
    def test_same_answers_as_dict(self):
        d = {_md5(i): 1000 + i for i in range(5000)}
        cs = ChunkSet(d)
        self.assertEqual(len(cs), len(d))
        for m, size in list(d.items())[::97]:
            self.assertIn(m, cs)
            self.assertEqual(cs.get(m), size)
        self.assertEqual(dict(cs.items()), d)
        self.assertNotIn(_md5(99999), cs)
        self.assertIsNone(cs.get(_md5(99999)))
        self.assertEqual(cs.get(_md5(99999), -1), -1)

    def test_uppercase_and_invalid_keys(self):
        cs = ChunkSet([(_md5(1).upper(), 5), ("zz" * 16, 1), ("abc", 2)])
        self.assertEqual(len(cs), 1)
        self.assertIn(_md5(1), cs)
        for bad in ("", "xyz", "zz" * 16, None, _md5(1)[:30]):
            self.assertNotIn(bad, cs)
            self.assertIsNone(cs.get(bad))

    def test_bad_size_never_matches_and_never_raises(self):
        """uszkodzony manifest (rozmiar ujemny, za duży, nie liczba) — build odrzucony przy sprawdzaniu, indeks działa"""
        cs = ChunkSet([(_md5(1), -1), (_md5(2), 2**70), (_md5(3), "x"), (_md5(4), 7)])
        self.assertEqual(len(cs), 4)
        for i in (1, 2, 3):
            self.assertNotIn(cs.get(_md5(i)), (-1, 0, 2**70))
        self.assertEqual(cs.get(_md5(4)), 7)

    def test_duplicate_keys(self):
        cs = ChunkSet([(_md5(1), 5), (_md5(1), 5)])
        self.assertEqual(len(cs), 1)

    def test_empty(self):
        cs = ChunkSet({})
        self.assertEqual(len(cs), 0)
        self.assertNotIn(_md5(1), cs)
        self.assertEqual(list(cs.items()), [])

    def test_much_smaller_than_dict(self):
        n = 50000                                # napisy powstają w pomiarze, jak przy czytaniu manifestów
        tracemalloc.start()
        d = {_md5(i): 500000 + i for i in range(n)}
        as_dict = tracemalloc.get_traced_memory()[0]
        del d
        tracemalloc.stop()
        tracemalloc.start()
        cs = ChunkSet((_md5(i), 500000 + i) for i in range(n))
        as_set = tracemalloc.get_traced_memory()[0]
        tracemalloc.stop()
        self.assertEqual(len(cs), n)
        self.assertLess(as_set, as_dict / 4)
        self.assertLess(as_set / n, 32)          # ~20 B na chunk


if __name__ == "__main__":
    unittest.main()


class ChunkSetReviewTest(unittest.TestCase):
    def test_lookalike_keys_are_not_members(self):
        real = "0123456789abcdef" * 2
        cs = ChunkSet({real: 10})
        for fake in ("0_23456789abcdef" + real[16:], " " + real[1:], "0x" + real[2:], "+" + real[1:]):
            self.assertEqual(len(fake), 32)
            self.assertNotIn(fake, cs)

    def test_duplicate_keeps_last_value_like_a_dict(self):
        m = _md5(7)
        self.assertEqual(ChunkSet([(m, 100), (m, 120)]).get(m), 120)
        self.assertEqual(ChunkSet([(m, 120), (m, 100)]).get(m), 100)

    def test_size_as_text_still_matches(self):
        from emustart.gogarchive import csize
        self.assertEqual(csize("123"), 123)
        self.assertEqual(ChunkSet([(_md5(1), "123")]).get(_md5(1)), 123)
