import unittest
from pkg import slug


class SlugTest(unittest.TestCase):
    def test_slug(self):
        self.assertEqual(slug(" Hello, World! "), "hello-world")
